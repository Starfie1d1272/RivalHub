import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import type { TxDb } from "../../../src/db/client";
import * as schema from "../../../src/db/schema";
import { publicCompetitionEntryCondition } from "../../../src/lib/competition-entries/public-visibility";
import { createCompetitionEntryInTx, saveCompetitionEntryRosterInTx, confirmCompetitionEntryParticipationInTx, submitCompetitionEntryInTx, withdrawCompetitionEntryFromReviewInTx } from "../../../src/lib/competition-entries/commands";
import { createLocalPool, capturePostgresError } from "./harness/database";

// Every fixture is rolled back, including the circular entry/revision facts.
describe("registration opening PostgreSQL", () => {
  it("uses the approved set for list, count and known-id lookup while private reads retain every status", async () => {
    const pool = createLocalPool(); const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const database = drizzle(client, { schema });
      const seasonId = randomUUID(); const userId = randomUUID();
      await database.insert(schema.users).values({ id: userId, email: `${userId}@local.test` });
      await database.insert(schema.seasons).values({ id: seasonId, slug: seasonId, name: "Public visibility", kind: "Major", registrationMode: "team", status: "registration" });
      const statuses = [...schema.competitionEntryRegistrationStatusEnum.enumValues.filter((status) => status !== "approved"), ...Array.from({ length: 33 }, () => "approved" as const)];
      const hiddenIds: string[] = [];
      for (const status of statuses) {
        const id = randomUUID(); const revisionId = randomUUID();
        await database.insert(schema.competitionEntries).values({ id, competitionId: seasonId, source: "event_native", name: status, representativeUserId: userId, registrationStatus: status, currentRosterRevisionId: revisionId });
        await database.insert(schema.competitionEntryRosterRevisions).values({ id: revisionId, entryId: id, revisionNumber: 1, createdBy: userId });
        if (status !== "approved") hiddenIds.push(id);
      }
      const where = and(eq(schema.competitionEntries.competitionId, seasonId), publicCompetitionEntryCondition());
      const visible = await database.query.competitionEntries.findMany({ where });
      const [total] = await database.select({ value: count() }).from(schema.competitionEntries).where(where);
      expect(visible).toHaveLength(33); expect(total.value).toBe(33);
      for (const id of hiddenIds) {
        expect(await database.query.competitionEntries.findFirst({ where: and(where, eq(schema.competitionEntries.id, id)) })).toBeUndefined();
        expect(await database.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, id) })).toBeDefined();
      }
    } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
  });

  it("lets a captain fill a missing entry logo by saving, without rewriting an existing event logo", async () => {
    const pool = createLocalPool(); const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const database = drizzle(client, { schema }); const tx = database as unknown as TxDb;
      const seasonId = randomUUID(); const userId = randomUUID(); const teamId = randomUUID();
      await database.insert(schema.users).values({ id: userId, email: `${userId}@local.test` });
      await database.insert(schema.seasons).values({ id: seasonId, slug: seasonId, name: "Logo correction", kind: "custom", registrationMode: "team", status: "registration", registrationOpensAt: new Date(Date.now() - 60000), registrationOpenedAt: new Date(Date.now() - 60000), minTeamSize: 1, maxTeamSize: 9, starterCount: 1, teamRegistrationConfig: { requireTeamLogo: true, requireCompetitiveProfile: false } as schema.Season["teamRegistrationConfig"] });
      await database.insert(schema.teams).values({ id: teamId, slug: teamId, name: "Logo team", creatorUserId: userId, captainUserId: userId });
      await database.insert(schema.teamMemberships).values({ teamId, userId });
      const { entryId } = await createCompetitionEntryInTx(tx, { competitionId: seasonId, teamId, userId, actorId: userId });
      const originalRevisionId = (await database.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, entryId) }))!.currentRosterRevisionId;
      const save = () => saveCompetitionEntryRosterInTx(tx, { entryId, userId, actorId: userId, userIds: [userId], primaryStarterUserIds: [userId] });
      await save(); await confirmCompetitionEntryParticipationInTx(tx, { entryId, userId, actorId: userId });
      const missingLogo = await capturePostgresError(client, () => submitCompetitionEntryInTx(tx, { entryId, userId, actorId: userId }));
      expect(missingLogo).toMatchObject({ message: "请先上传队伍图标并保存本届名单。" });
      await database.update(schema.teams).set({ logoUrl: "https://local.test/first.png" }).where(eq(schema.teams.id, teamId));
      await save();
      await database.update(schema.teams).set({ logoUrl: "https://local.test/second.png" }).where(eq(schema.teams.id, teamId));
      await save();
      expect((await database.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, entryId) }))?.logoUrl).toBe("https://local.test/first.png");
      await submitCompetitionEntryInTx(tx, { entryId, userId, actorId: userId });
      expect((await database.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, entryId) }))?.registrationStatus).toBe("submitted");
      const repeated = await capturePostgresError(client, () => submitCompetitionEntryInTx(tx, { entryId, userId, actorId: userId }));
      expect(repeated).toMatchObject({ message: "当前报名状态不能提交。" });

      await withdrawCompetitionEntryFromReviewInTx(tx, { entryId, userId, actorId: userId });
      const withdrawnFromReview = await database.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, entryId) });
      expect(withdrawnFromReview).toMatchObject({ registrationStatus: "draft", submittedAt: null, reviewReason: null });
      expect(withdrawnFromReview?.currentRosterRevisionId).not.toBe(originalRevisionId);
      expect(await database.select({ status: schema.competitionEntryRosterRevisions.status, origin: schema.competitionEntryRosterRevisions.origin }).from(schema.competitionEntryRosterRevisions).where(eq(schema.competitionEntryRosterRevisions.entryId, entryId)).orderBy(schema.competitionEntryRosterRevisions.revisionNumber)).toEqual([
        { status: "superseded", origin: "initial" },
        { status: "draft", origin: "initial" },
      ]);
      expect((await database.select({ value: count() }).from(schema.competitionEntryRosterMembers).where(eq(schema.competitionEntryRosterMembers.revisionId, withdrawnFromReview!.currentRosterRevisionId)))[0]?.value).toBe(1);
      expect((await database.select({ value: count() }).from(schema.competitionEntryActiveClaims).where(eq(schema.competitionEntryActiveClaims.entryId, entryId)))[0]?.value).toBe(1);
      expect(await database.select({ decision: schema.competitionEntrySubmissions.decision }).from(schema.competitionEntrySubmissions).where(eq(schema.competitionEntrySubmissions.entryId, entryId))).toEqual([{ decision: "submitted" }]);
      expect((await database.select({ value: count() }).from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, entryId), eq(schema.auditLogs.action, "competition_entry.review.withdraw"))))[0]?.value).toBe(1);

      await save();
      await submitCompetitionEntryInTx(tx, { entryId, userId, actorId: userId });
      expect((await database.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, entryId) }))?.registrationStatus).toBe("submitted");
      expect((await database.select({ value: count() }).from(schema.competitionEntrySubmissions).where(eq(schema.competitionEntrySubmissions.entryId, entryId)))[0]?.value).toBe(2);
    } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
  });
});
