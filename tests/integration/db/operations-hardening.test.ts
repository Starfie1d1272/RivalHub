/**
 * Operations & Public Info Real PostgreSQL Integration Tests
 * Covers Announcements, Season Public Info, and Feedback Abuse Behavior
 */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
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

      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const attentionReadAt = Date.now();
        const seasonAttention = await getRelevantAttentionAnnouncement(seasonId);
        expect(seasonAttention?.id).toBe(draft.id);

        await database.transaction((tx) => updateAnnouncementInTx(tx, adminContext, draft.id, {
          scope: "season",
          seasonId,
          type: "important_alert",
          title: "赛程调整通知（正式）",
          body: "首轮正式延期至 19:30 开始。",
          requiresAttention: true,
          attentionUntil: new Date(attentionReadAt - 1_000),
        }));
        vi.setSystemTime(attentionReadAt + 60_000);
        const fallbackAttention = await getRelevantAttentionAnnouncement(seasonId);
        expect(fallbackAttention?.id).toBe(siteAttention.id);
      } finally {
        vi.useRealTimers();
      }

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

  it("enforces feedback triage and the actual deduplication/cooldown window boundaries", async () => {
    const pool = createLocalPool({ max: 2 });
    const client = await pool.connect();
    const database = drizzle(client, { schema });
    const actorId = randomUUID();
    const userId = randomUUID();
    const seasonId = randomUUID();
    const releaseVersion = `ops-test-${seasonId}`;
    try {
      await database.insert(users).values([
        { id: actorId, email: `admin-${actorId}@test.local`, role: "super_admin" },
        { id: userId, email: `user-${userId}@test.local`, role: "user" },
      ]);
      await database.insert(seasons).values({ id: seasonId, slug: `ops-fb-${seasonId.slice(0, 8)}`, name: "Feedback Season", kind: "major", status: "playing", stagePlan: [] });
      // Fake only the application clock; PostgreSQL and network timers remain real.
      vi.useFakeTimers({ toFake: ["Date"] });
      const now = Date.now();
      const submit = (body: string, actorUserId: string | null = null, scope: string | null = null) =>
        database.transaction((tx) => submitFeedbackInTx(tx, { actorUserId, seasonId: scope, category: "problem", body, pathname: "/test", releaseVersion }));
      const age = (id: string, elapsedMs: number) => database.update(feedbackReports)
        .set({ createdAt: new Date(now - elapsedMs) }).where(eq(feedbackReports.id, id));

      const body = `Duplicate issue ${randomUUID()}`;
      const first = await submit(body);
      await age(first.id!, 59_999);
      await expect(submit(body)).rejects.toThrow(/相同反馈刚刚已经提交过了/);
      await age(first.id!, 60_001);
      await expect(submit(body)).resolves.toMatchObject({ accepted: true });

      const authenticated = await submit(`First authenticated ${randomUUID()}`, userId);
      await age(authenticated.id!, 29_999);
      await expect(submit(`Inside cooldown ${randomUUID()}`, userId)).rejects.toThrow(/反馈提交较频繁/);
      await age(authenticated.id!, 30_001);
      await expect(submit(`Outside cooldown ${randomUUID()}`, userId)).resolves.toMatchObject({ accepted: true });

      const triage = await submit(`Issue to triage ${randomUUID()}`, null, seasonId);
      const [stored] = await database.select().from(feedbackReports).where(eq(feedbackReports.id, triage.id!));
      expect(stored.status).toBe("new");
      for (const status of ["triaged", "resolved"] as const) {
        const changed = await database.transaction((tx) => setFeedbackStatusInTx(tx, { id: triage.id!, status, actorId }));
        expect(changed.status).toBe(status);
      }

      // Two recent anonymous rows exist: the accepted duplicate and the triage subject.
      for (let i = 0; i < 18; i++) await submit(`Anonymous ${i} ${randomUUID()}`);
      await expect(submit(`Limit reached ${randomUUID()}`)).rejects.toThrow(/反馈较多，请稍后再试/);
      await age(triage.id!, 60_001);
      await expect(submit(`Expired row frees capacity ${randomUUID()}`)).resolves.toMatchObject({ accepted: true });
      await expect(submit(`Capacity exhausted again ${randomUUID()}`)).rejects.toThrow(/反馈较多，请稍后再试/);
    } finally {
      vi.useRealTimers();
      await database.delete(feedbackReports).where(eq(feedbackReports.releaseVersion, releaseVersion));
      await database.delete(auditLogs).where(eq(auditLogs.actorId, actorId));
      await database.delete(seasons).where(eq(seasons.id, seasonId));
      await database.delete(users).where(eq(users.id, actorId));
      await database.delete(users).where(eq(users.id, userId));
      client.release();
      await pool.end();
    }
  });
});
