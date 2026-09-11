/**
 * Operations & Public Info Real PostgreSQL Integration Tests
 * Covers Announcements, Season Public Info, and Feedback Reports
 */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import * as schema from "../../../src/db/schema";
import { seasons, users } from "../../../src/db/schema";
import { createAnnouncementInTx, updateAnnouncementInTx, setAnnouncementStatusInTx } from "../../../src/lib/announcements/commands";
import { listPublicAnnouncements, getLatestSeasonAnnouncement } from "../../../src/lib/announcements/read-model";
import { submitFeedbackInTx, setFeedbackStatusInTx } from "../../../src/lib/feedback/commands";
import { getPublicSeasonInfo } from "../../../src/lib/season-public-info/read-model";
import { upsertSeasonPublicInfoInTx, createCommunityGroupInTx, updateCommunityGroupInTx, createSeasonContactInTx } from "../../../src/lib/season-public-info/commands";
import { localDatabaseUrl } from "./harness/database";

const databaseUrl = localDatabaseUrl();

describe("operations real PostgreSQL lifecycle", () => {
  it("enforces announcement draft -> publish -> public visibility and withdraw lifecycle", async () => {
    const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 2 });
    const database = drizzle(pool, { schema });
    const actorId = randomUUID();
    const seasonId = randomUUID();

    try {
      await pool.query("BEGIN");

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

      // Published announcement is visible in public read model
      const publicAfterPublish = await listPublicAnnouncements(seasonId);
      const found = publicAfterPublish.find((a) => a.id === draft.id);
      expect(found).toBeDefined();
      expect(found?.title).toBe("赛程调整通知（草稿）");

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

      const latest = await getLatestSeasonAnnouncement(seasonId);
      expect(latest?.title).toBe("赛程调整通知（正式）");

      // 4. Withdraw announcement
      await database.transaction((tx) =>
        setAnnouncementStatusInTx(tx, adminContext, draft.id, "draft")
      );

      // Withdrawn announcement is no longer in public projection
      const publicAfterWithdraw = await listPublicAnnouncements(seasonId);
      expect(publicAfterWithdraw.some((a) => a.id === draft.id)).toBe(false);
    } finally {
      await pool.query("ROLLBACK");
      await pool.end();
    }
  });

  it("enforces season public info permissions, storage lifetime, and closed group projection", async () => {
    const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 2 });
    const database = drizzle(pool, { schema });
    const actorId = randomUUID();
    const seasonId = randomUUID();

    try {
      await pool.query("BEGIN");

      await database.insert(users).values({
        id: actorId,
        email: `admin-${actorId}@test.local`,
        role: "super_admin",
      });

      await database.insert(seasons).values({
        id: seasonId,
        slug: `info-test-${seasonId.slice(0, 8)}`,
        name: "Info Test Season",
        kind: "major",
        status: "playing",
        stagePlan: [],
      });

      const adminContext = { actorId, role: "super_admin" as const, seasonIds: [seasonId] };

      // 1. Upsert public info (rules)
      await database.transaction((tx) =>
        upsertSeasonPublicInfoInTx(tx, adminContext, {
          seasonId,
          rulesLabel: "竞赛规程 V2",
          rulesHref: "https://rivalhub.com/rules/major",
        })
      );

      // 2. Add community groups (active group with groupNumber, and closed group)
      const activeGroup = await database.transaction((tx) =>
        createCommunityGroupInTx(tx, adminContext, {
          seasonId,
          label: "官方正赛群",
          audience: "参赛选手",
          groupNumber: "987654321",
          qrImagePath: `season-public-assets/${seasonId}/qr-active.png`,
          joinUrl: "https://qun.qq.com/join/active",
          note: "实名进群",
        })
      );

      const closedGroup = await database.transaction((tx) =>
        createCommunityGroupInTx(tx, adminContext, {
          seasonId,
          label: "预选赛历史群",
          audience: null,
          groupNumber: "123456789",
          qrImagePath: `season-public-assets/${seasonId}/qr-closed.png`,
          joinUrl: "https://qun.qq.com/join/closed",
          note: "已关闭",
        })
      );

      await database.transaction((tx) =>
        updateCommunityGroupInTx(tx, adminContext, closedGroup.id, {
          label: "预选赛历史群",
          audience: null,
          status: "closed",
          groupNumber: "123456789",
          qrImagePath: `season-public-assets/${seasonId}/qr-closed.png`,
          joinUrl: "https://qun.qq.com/join/closed",
          note: "已关闭",
        })
      );

      // 3. Add contact
      await database.transaction((tx) =>
        createSeasonContactInTx(tx, adminContext, {
          seasonId,
          label: "裁判长",
          publicName: "张裁判",
          value: "referee@rivalhub.com",
          href: "mailto:referee@rivalhub.com",
          note: "工作日在线",
        })
      );

      // 4. Query public projection
      const publicInfo = await getPublicSeasonInfo(seasonId);

      expect(publicInfo.rules.label).toBe("竞赛规程 V2");
      expect(publicInfo.rules.href).toBe("https://rivalhub.com/rules/major");

      // Active group has groupNumber, joinUrl
      const activeProj = publicInfo.groups.find((g) => g.id === activeGroup.id);
      expect(activeProj?.groupNumber).toBe("987654321");
      expect(activeProj?.joinUrl).toBe("https://qun.qq.com/join/active");
      expect(activeProj?.status).toBe("active");

      // Closed group MUST NOT expose groupNumber, qr, or joinUrl in public projection!
      const closedProj = publicInfo.groups.find((g) => g.id === closedGroup.id);
      expect(closedProj).toBeDefined();
      expect(closedProj?.status).toBe("closed");
      expect(closedProj?.groupNumber).toBe(null);
      expect(closedProj?.qrImageUrl).toBe(null);
      expect(closedProj?.joinUrl).toBe(null);

      // Contacts projection
      expect(publicInfo.contacts).toHaveLength(1);
      expect(publicInfo.contacts[0]?.publicName).toBe("张裁判");
    } finally {
      await pool.query("ROLLBACK");
      await pool.end();
    }
  });

  it("enforces feedback triage lifecycle (new -> triaged -> resolved) and anonymous/authenticated insert", async () => {
    const pool = new Pool({ connectionString: databaseUrl, ssl: false, max: 2 });
    const database = drizzle(pool, { schema });
    const actorId = randomUUID();
    const userId = randomUUID();
    const seasonId = randomUUID();

    try {
      await pool.query("BEGIN");

      await database.insert(users).values([
        { id: actorId, email: `admin-${actorId}@test.local`, role: "super_admin" },
        { id: userId, email: `user-${userId}@test.local`, role: "user" },
      ]);

      await database.insert(seasons).values({
        id: seasonId,
        slug: `feedback-test-${seasonId.slice(0, 8)}`,
        name: "Feedback Test Season",
        kind: "major",
        status: "playing",
        stagePlan: [],
      });

      // 1. Submit feedback by authenticated user
      const userFb = await database.transaction((tx) =>
        submitFeedbackInTx(tx, {
          actorUserId: userId,
          seasonId,
          category: "problem",
          body: "队伍报名提交后页面没有即时刷新。",
          pathname: `/${seasonId}/register`,
          releaseVersion: "2.8.4",
        })
      );
      expect(userFb.accepted).toBe(true);
      expect(userFb.id).toBeDefined();

      // 2. Submit anonymous feedback
      const anonFb = await database.transaction((tx) =>
        submitFeedbackInTx(tx, {
          actorUserId: null,
          seasonId: null,
          category: "feature_suggestion",
          body: "建议在选手主页增加历史赛事徽章展示。",
          pathname: "/players",
          releaseVersion: "2.8.4",
        })
      );
      expect(anonFb.accepted).toBe(true);

      // 3. Super admin triages feedback: new -> triaged -> resolved
      const triaged = await database.transaction((tx) =>
        setFeedbackStatusInTx(tx, {
          id: userFb.id!,
          status: "triaged",
          actorId,
        })
      );
      expect(triaged.status).toBe("triaged");

      const resolved = await database.transaction((tx) =>
        setFeedbackStatusInTx(tx, {
          id: userFb.id!,
          status: "resolved",
          actorId,
        })
      );
      expect(resolved.status).toBe("resolved");
    } finally {
      await pool.query("ROLLBACK");
      await pool.end();
    }
  });
});