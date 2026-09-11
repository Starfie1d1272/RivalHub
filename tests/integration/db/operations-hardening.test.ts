/**
 * Operations & Public Info Real PostgreSQL Integration Tests
 * Covers Announcements, Season Public Info, and Feedback Abuse Behavior
 */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { announcements, auditLogs, communityGroups, feedbackReports, seasons, users } from "../../../src/db/schema";
import { eq } from "drizzle-orm";
import { createAnnouncementInTx, updateAnnouncementInTx, setAnnouncementStatusInTx } from "../../../src/lib/announcements/commands";
import { getRelevantAttentionAnnouncement, listPublicAnnouncements } from "../../../src/lib/announcements/read-model";
import { submitFeedbackInTx, setFeedbackStatusInTx } from "../../../src/lib/feedback/commands";
import { createCommunityGroupInTx, createSeasonContactInTx, updateCommunityGroupInTx, upsertSeasonPublicInfoInTx } from "../../../src/lib/season-public-info/commands";
import { getPublicSeasonInfo } from "../../../src/lib/season-public-info/read-model";
import { createLocalPool } from "./harness/database";

describe("operations real PostgreSQL lifecycle & abuse hardening", () => {
  it("enforces announcement draft -> publish -> public visibility and withdraw lifecycle", async () => {
    const pool = createLocalPool({ max: 2 });
    const client = await pool.connect();
    const database = drizzle(client, { schema });
    const actorId = randomUUID();
    const seasonId = randomUUID();

    try {
      await database.insert(users).values({
        id: actorId,
        email: `admin-${actorId}@test.local`,
        role: "super_admin",
      });

      await database.insert(seasons).values({
        id: seasonId,
        slug: `ops-test-${seasonId.slice(0, 8)}`,
        name: "Operations Test Season",
        kind: "major",
        status: "playing",
        stagePlan: [],
      });

      const adminContext = { actorId, role: "super_admin" as const, seasonIds: [seasonId] };

      // 1. Create draft announcement
      const draft = await database.transaction((tx) =>
        createAnnouncementInTx(tx, adminContext, {
          scope: "season",
          seasonId,
          type: "notice",
          title: "赛程调整通知（草稿）",
          body: "因设备维护，首轮延迟 30 分钟。",
          requiresAttention: false,
          attentionUntil: null,
        })
      );

      expect(draft.id).toBeDefined();

      // Draft must NOT be visible in public read model
      const publicBeforePublish = await listPublicAnnouncements(seasonId);
      expect(publicBeforePublish.some((a) => a.id === draft.id)).toBe(false);

      // 2. Publish announcement
      const published = await database.transaction((tx) =>
        setAnnouncementStatusInTx(tx, adminContext, draft.id, "published")
      );

      expect(published.status).toBe("published");

      const publicAfterPublish = await listPublicAnnouncements(seasonId);
      expect(publicAfterPublish).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: draft.id, title: "赛程调整通知（草稿）" }),
      ]));

      const [beforeEdit] = await database
        .select({ status: announcements.status, updatedAt: announcements.updatedAt })
        .from(announcements)
        .where(eq(announcements.id, draft.id));

      // 3. Edit published announcement - must remain published and update updatedAt
      const updated = await database.transaction((tx) =>
        updateAnnouncementInTx(tx, adminContext, draft.id, {
          scope: "season",
          seasonId,
          type: "notice",
          title: "赛程调整通知（正式）",
          body: "首轮正式延期至 19:30 开始。",
          requiresAttention: true,
          attentionUntil: new Date(Date.now() + 3600_000),
        })
      );

      expect(updated.id).toBe(draft.id);
      const [afterEdit] = await database
        .select({ status: announcements.status, updatedAt: announcements.updatedAt })
        .from(announcements)
        .where(eq(announcements.id, draft.id));
      expect(afterEdit?.status).toBe("published");
      expect(afterEdit?.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeEdit?.updatedAt.getTime() ?? 0);

      const siteAttention = await database.transaction((tx) =>
        createAnnouncementInTx(tx, adminContext, {
          scope: "site",
          seasonId: null,
          type: "important_alert",
          title: "全站提醒",
          body: "全站维护提醒。",
          requiresAttention: true,
          attentionUntil: new Date(Date.now() + 3_600_000),
        }),
      );
      await database.transaction((tx) => setAnnouncementStatusInTx(tx, adminContext, siteAttention.id, "published"));

      const seasonAttention = await getRelevantAttentionAnnouncement(seasonId);
      expect(seasonAttention?.id).toBe(draft.id);

      await database.transaction((tx) => updateAnnouncementInTx(tx, adminContext, draft.id, {
        scope: "season",
        seasonId,
        type: "important_alert",
        title: "赛程调整通知（正式）",
        body: "首轮正式延期至 19:30 开始。",
        requiresAttention: true,
        attentionUntil: new Date(Date.now() - 1_000),
      }));
      const fallbackAttention = await getRelevantAttentionAnnouncement(seasonId);
      expect(fallbackAttention?.id).toBe(siteAttention.id);

      // 4. Withdraw announcement
      await database.transaction((tx) =>
        setAnnouncementStatusInTx(tx, adminContext, draft.id, "draft")
      );

      // Withdrawn announcement is no longer in public projection
      const publicAfterWithdraw = await listPublicAnnouncements(seasonId);
      expect(publicAfterWithdraw.some((a) => a.id === draft.id)).toBe(false);
    } finally {
      await database.delete(announcements).where(eq(announcements.createdBy, actorId));
      await database.delete(auditLogs).where(eq(auditLogs.actorId, actorId));
      await database.delete(seasons).where(eq(seasons.id, seasonId));
      await database.delete(users).where(eq(users.id, actorId));
      client.release();
      await pool.end();
    }
  });

  it("enforces season public info permissions and closed group projection", async () => {
    const pool = createLocalPool({ max: 2 });
    const client = await pool.connect();
    const database = drizzle(client, { schema });
    const actorId = randomUUID();
    const seasonId = randomUUID();

    try {
      await database.insert(users).values({
        id: actorId,
        email: `admin-${actorId}@test.local`,
        role: "super_admin",
      });

      await database.insert(seasons).values({
        id: seasonId,
        slug: `ops-info-${seasonId.slice(0, 8)}`,
        name: "Public Info Season",
        kind: "major",
        status: "registration",
        stagePlan: [],
      });

      const adminContext = { actorId, role: "super_admin" as const, seasonIds: [seasonId] };

      // 1. Upsert rules entry
      await database.transaction((tx) =>
        upsertSeasonPublicInfoInTx(tx, adminContext, {
          seasonId,
          rulesLabel: "赛事规程与行为守则",
          rulesHref: "/rules",
        })
      );

      // 2. Create a group through the group-number-first workflow.
      const group = await database.transaction((tx) =>
        createCommunityGroupInTx(tx, adminContext, {
          seasonId,
          label: "选手交流群",
          audience: "参赛选手及领队",
          groupNumber: "123456789",
          joinUrl: null,
          qrImagePath: null,
          note: "入群请备注队伍名",
        })
      );

      const contact = await database.transaction((tx) => createSeasonContactInTx(tx, adminContext, {
        seasonId,
        label: "赛委会",
        publicName: "运营组",
        value: "ops@example.com",
        href: "mailto:ops@example.com",
        note: null,
      }));

      const publicInfo = await getPublicSeasonInfo(seasonId);
      expect(publicInfo.rules).toEqual({ label: "赛事规程与行为守则", href: "/rules" });
      expect(publicInfo.groups).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: group.id, status: "active", groupNumber: "123456789" }),
      ]));
      expect(publicInfo.contacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: contact.id, value: "ops@example.com", href: "mailto:ops@example.com" }),
      ]));

      // 4. Close group -> active projection hides join facts and QR URL
      await database.transaction((tx) =>
        updateCommunityGroupInTx(tx, adminContext, group.id, {
          label: group.label,
          audience: group.audience,
          status: "closed",
          groupNumber: null,
          joinUrl: null,
          note: group.note,
          qrImagePath: null,
        })
      );
      const [closedRow] = await database.select().from(communityGroups).where(eq(communityGroups.id, group.id));
      expect(closedRow.status).toBe("closed");
      expect(closedRow.qrImagePath).toBeNull();
      expect(closedRow.groupNumber).toBeNull();
      const publicAfterClose = await getPublicSeasonInfo(seasonId);
      expect(publicAfterClose.groups.find((item) => item.id === group.id)).toMatchObject({
        status: "closed",
        groupNumber: null,
        joinUrl: null,
        qrImageUrl: null,
      });
    } finally {
      await database.delete(auditLogs).where(eq(auditLogs.actorId, actorId));
      await database.delete(seasons).where(eq(seasons.id, seasonId));
      await database.delete(users).where(eq(users.id, actorId));
      client.release();
      await pool.end();
    }
  });

  it("enforces feedback triage lifecycle and abuse prevention contracts", async () => {
    const pool = createLocalPool({ max: 2 });
    const client = await pool.connect();
    const database = drizzle(client, { schema });
    const actorId = randomUUID();
    const userId = randomUUID();
    const seasonId = randomUUID();
    const feedbackReleaseVersion = `ops-test-${seasonId}`;

    try {
      await database.insert(users).values([
        {
          id: actorId,
          email: `admin-${actorId}@test.local`,
          role: "super_admin",
        },
        {
          id: userId,
          email: `user-${userId}@test.local`,
          role: "user",
        },
      ]);

      await database.insert(seasons).values({
        id: seasonId,
        slug: `ops-fb-${seasonId.slice(0, 8)}`,
        name: "Feedback Season",
        kind: "major",
        status: "playing",
        stagePlan: [],
      });

      // 1. Behavior: 60s duplicate body reject.
      const duplicateBody = "Duplicate issue content across requests";
      await database.transaction((tx) =>
        submitFeedbackInTx(tx, {
          actorUserId: null,
          category: "feature_suggestion",
          body: duplicateBody,
          pathname: "/test",
          seasonId: null,
          releaseVersion: feedbackReleaseVersion,
        })
      );

      // Immediately submitting the same body must reject with duplicate error
      await expect(
        database.transaction((tx) =>
          submitFeedbackInTx(tx, {
            actorUserId: null,
            category: "feature_suggestion",
            body: duplicateBody,
            pathname: "/test",
            seasonId: null,
            releaseVersion: feedbackReleaseVersion,
          })
        )
      ).rejects.toThrowError(/相同反馈刚刚已经提交过了/);

      // 2. Behavior: Authenticated 30s cooldown reject.
      await database.transaction((tx) =>
        submitFeedbackInTx(tx, {
          actorUserId: userId,
          category: "other",
          body: `User first submission ${randomUUID()}`,
          pathname: "/test",
          seasonId: null,
          releaseVersion: feedbackReleaseVersion,
        })
      );

      await expect(
        database.transaction((tx) =>
          submitFeedbackInTx(tx, {
            actorUserId: userId,
            category: "other",
            body: `User second submission within cooldown ${randomUUID()}`,
            pathname: "/test",
            seasonId: null,
            releaseVersion: feedbackReleaseVersion,
          })
        )
      ).rejects.toThrowError(/反馈提交较频繁/);

      // 3. Status triage lifecycle: new -> triaged -> resolved.
      const triageSubject = await database.transaction((tx) =>
        submitFeedbackInTx(tx, {
          actorUserId: null,
          category: "problem",
          body: "Specific issue for triage lifecycle test",
          pathname: "/seasons/test",
          seasonId,
          releaseVersion: feedbackReleaseVersion,
        })
      );

      expect(triageSubject.id).toBeDefined();
      const [insertedRow] = await database.select().from(feedbackReports).where(eq(feedbackReports.id, triageSubject.id!));
      expect(insertedRow.status).toBe("new");

      const triaged = await database.transaction((tx) =>
        setFeedbackStatusInTx(tx, { id: triageSubject.id!, status: "triaged", actorId })
      );
      expect(triaged.status).toBe("triaged");

      const resolved = await database.transaction((tx) =>
        setFeedbackStatusInTx(tx, { id: triageSubject.id!, status: "resolved", actorId })
      );
      expect(resolved.status).toBe("resolved");

      // 4. Behavior: the anonymous coarse limit rejects the 21st row in one minute.
      // Two anonymous rows already exist above, so add 18 more before probing the boundary.
      for (let i = 0; i < 18; i++) {
        await database.transaction((tx) => submitFeedbackInTx(tx, {
          actorUserId: null,
          category: "problem",
          body: `Unique problem body #${i} ${randomUUID()}`,
          pathname: "/test",
          seasonId: null,
          releaseVersion: feedbackReleaseVersion,
        }));
      }
      await expect(
        database.transaction((tx) => submitFeedbackInTx(tx, {
          actorUserId: null,
          category: "problem",
          body: `21st problem body ${randomUUID()}`,
          pathname: "/test",
          seasonId: null,
          releaseVersion: feedbackReleaseVersion,
        })),
      ).rejects.toThrowError(/反馈较多，请稍后再试/);
    } finally {
      await database.delete(feedbackReports).where(eq(feedbackReports.releaseVersion, feedbackReleaseVersion));
      await database.delete(auditLogs).where(eq(auditLogs.actorId, actorId));
      await database.delete(seasons).where(eq(seasons.id, seasonId));
      await database.delete(users).where(eq(users.id, actorId));
      await database.delete(users).where(eq(users.id, userId));
      client.release();
      await pool.end();
    }
  });
});
