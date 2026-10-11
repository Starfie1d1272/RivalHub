/**
 * #912: mocked rejection cannot prove PG rollback or the real admin recovery
 * chain. A fixture-scoped audit trigger fails after lineup INSERT, then the
 * same authorized manual runner and workbench read owner prove recovery.
 * Only session and Next cache boundaries are substituted, never domain/DB.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { seedFixture } from "./harness/mizar";
import { createLocalPool } from "./harness/database";
import { runMatchTimeAutoAwardCron } from "@/lib/matches/time-auto-award";
import { loadAdminMatchWorkbench } from "@/lib/admin/matches/workbench";
import { confirmMatchRosterInTx } from "@/lib/match-rosters/service";
import { extractPgError } from "@/db/errors";
import * as observability from "@/lib/observability/server";
import type { StructuredEvent } from "@/lib/observability/logger";

const auth = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/auth/session", () => ({
  requireSuperAdmin: async () => ({ userId: auth.userId, role: "super_admin", seasonIds: [] }),
  requireSeasonAdmin: async () => ({ userId: auth.userId, role: "super_admin", seasonIds: [] }),
  auditActorId: (admin: { userId: string }) => admin.userId,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/revalidation", () => ({ revalidateMatchPaths: vi.fn() }));
import { runSchedulerJobManually } from "@/actions/scheduler";
import { revalidateMatchPaths } from "@/lib/revalidation";

it("distinguishes legitimate waiting, PG failure, manual recovery and repeated runs without rewriting confirmed facts", async () => {
  const fixture = await seedFixture({ matchStatus: "scheduled" });
  auth.userId = (await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, fixture.entryAId) }))!.representativeUserId;
  const now = new Date();
  const [match] = await db.insert(schema.matches).values({ seasonId: fixture.seasonId,
    entryAId: fixture.entryAId, entryBId: fixture.entryBId, stage: "fixture-recovery",
    status: "scheduled", scheduledAt: new Date(now.getTime() + 60_000) }).returning();
  const capture = vi.spyOn(observability, "captureException");
  const rosterWhere = eq(schema.matchRosters.matchId, match.id);
  const defaultAuditWhere = and(eq(schema.auditLogs.action, "match.roster.system_default"), eq(schema.auditLogs.seasonId, fixture.seasonId));
  const pool = createLocalPool();
  const triggerName = `fail_lineup_${randomUUID().replaceAll("-", "")}`;
  let triggerInstalled = false;
  try {
    // Confirmed event roster is a legitimate start blocker outside Play-in.
    const waiting = await runMatchTimeAutoAwardCron(() => now);
    expect(waiting.lineups.blocked).toBeGreaterThanOrEqual(1);
    expect(waiting.lineupFailures).toEqual([]);
    expect(capture.mock.calls.filter(([event]) => event === "match.default_lineup.failure")).toHaveLength(0);
    expect(await db.select().from(schema.matchRosters).where(rosterWhere)).toHaveLength(0);
    expect(await runSchedulerJobManually({ jobKey: "match-time-auto-award" })).toMatchObject({ success: true });

    // Fixture eligibility changes explicitly; recovery never manufactures it.
    await db.update(schema.eventRosters).set({ status: "frozen", frozenAt: now, frozenBy: auth.userId })
      .where(inArray(schema.eventRosters.entryId, [fixture.entryAId, fixture.entryBId]));
    await pool.query(`CREATE FUNCTION ${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'match.roster.system_default' AND NEW.meta->>'matchId' = '${match.id}'
        THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'private SQL and secret fixture';
      END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${triggerName}()`);
    triggerInstalled = true;
    const healthBefore = await db.query.scheduledJobHealth.findFirst({ where: eq(schema.scheduledJobHealth.jobKey, "match-time-auto-award") });
    const failed = await runSchedulerJobManually({ jobKey: "match-time-auto-award" });
    expect(failed).toMatchObject({ success: false, error: { code: "INTERNAL_ERROR", requestId: expect.any(String) } });
    if (failed.success) throw new Error("original empty catch reports success here");
    expect(failed.error.message).toContain("恢复后");
    expect(failed.error.message).not.toContain("private SQL");
    const item = capture.mock.calls.findLast(([event]) => event === "match.default_lineup.failure")!;
    expect(extractPgError(item[1])?.code).toBe("23514");
    const logged = capture.mock.results[capture.mock.calls.indexOf(item)]!.value as StructuredEvent;
    expect(logged).toMatchObject({ errorClass: "database", errorCode: "23514", requestId: failed.error.requestId });
    expect(JSON.stringify(logged)).not.toMatch(/private SQL|secret fixture|INSERT INTO|params/);
    const healthFailed = await db.query.scheduledJobHealth.findFirst({ where: eq(schema.scheduledJobHealth.jobKey, "match-time-auto-award") });
    expect(healthFailed?.lastFailureCode).toBe("23514");
    expect(healthFailed?.lastManualSucceededAt).toEqual(healthBefore?.lastManualSucceededAt);
    expect(await db.select().from(schema.matchRosters).where(rosterWhere)).toHaveLength(0);
    expect(await db.select().from(schema.auditLogs).where(defaultAuditWhere)).toHaveLength(0);
    expect(await db.query.matches.findFirst({ where: eq(schema.matches.id, match.id) })).toEqual(match);
    const blockedPage = await loadAdminMatchWorkbench({ seasonSlug: fixture.seasonId, matchId: match.id });
    expect(blockedPage?.teamARoster).toBeNull();
    expect(blockedPage?.teamBRoster).toBeNull();

    await pool.query(`DROP TRIGGER ${triggerName} ON audit_logs`);
    triggerInstalled = false;
    const restored = await runSchedulerJobManually({ jobKey: "match-time-auto-award" });
    expect(restored).toMatchObject({ success: true, data: { businessTransitions: 2 } });
    expect(revalidateMatchPaths).toHaveBeenCalledWith(fixture.seasonId, match.id, { mode: "route" });
    const page = await loadAdminMatchWorkbench({ seasonSlug: fixture.seasonId, matchId: match.id });
    expect(page?.teamARoster?.starters).toHaveLength(5);
    expect(page?.teamBRoster?.starters).toHaveLength(5);
    const rosters = await db.select().from(schema.matchRosters).where(rosterWhere);
    expect(rosters).toHaveLength(2);
    expect(rosters.every(roster => roster.source === "system_default")).toBe(true);
    for (const roster of rosters) await db.transaction(tx => confirmMatchRosterInTx(tx, { rosterId: roster.id, actorId: auth.userId }));
    const confirmed = await db.select().from(schema.matchRosters).where(rosterWhere);
    const players = await db.select().from(schema.matchRosterPlayers).where(inArray(schema.matchRosterPlayers.rosterId, confirmed.map(row => row.id)));
    expect(await db.select().from(schema.auditLogs).where(defaultAuditWhere)).toHaveLength(2);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await runSchedulerJobManually({ jobKey: "match-time-auto-award" })).toMatchObject({ success: true, data: { businessTransitions: 0 } });
    }
    expect(await db.select().from(schema.matchRosters).where(rosterWhere)).toEqual(confirmed);
    expect(await db.select().from(schema.matchRosterPlayers).where(inArray(schema.matchRosterPlayers.rosterId, confirmed.map(row => row.id)))).toEqual(players);
    expect(await db.select().from(schema.auditLogs).where(defaultAuditWhere)).toHaveLength(2);
    expect(await db.query.matches.findFirst({ where: eq(schema.matches.id, match.id) })).toEqual(match);
  } finally {
    if (triggerInstalled) await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_logs`);
    await pool.query(`DROP FUNCTION IF EXISTS ${triggerName}()`);
    await pool.end();
    capture.mockRestore();
  }
});

it("leaves an incomplete declared default lineup waiting without inventing a fifth starter or alerting", async () => {
  const fixture = await seedFixture({ matchStatus: "scheduled" });
  auth.userId = (await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, fixture.entryAId) }))!.representativeUserId;
  const roster = (await db.query.eventRosters.findFirst({ where: eq(schema.eventRosters.entryId, fixture.entryAId) }))!;
  const member = (await db.query.eventRosterMembers.findFirst({ where: eq(schema.eventRosterMembers.eventRosterId, roster.id) }))!;
  await db.update(schema.eventRosterMembers).set({ isPrimaryStarter: false }).where(eq(schema.eventRosterMembers.id, member.id));
  await db.update(schema.eventRosters).set({ status: "frozen", frozenAt: new Date(), frozenBy: auth.userId })
    .where(inArray(schema.eventRosters.entryId, [fixture.entryAId, fixture.entryBId]));
  const [match] = await db.insert(schema.matches).values({ seasonId: fixture.seasonId,
    entryAId: fixture.entryAId, entryBId: fixture.entryBId, stage: "fixture-incomplete",
    status: "scheduled", scheduledAt: new Date(Date.now() + 60_000) }).returning();
  const capture = vi.spyOn(observability, "captureException");
  try {
    const result = await runSchedulerJobManually({ jobKey: "match-time-auto-award" });
    expect(result).toMatchObject({ success: true, data: { businessTransitions: 0 } });
    expect(capture.mock.calls.filter(([event]) => event === "match.default_lineup.failure")).toHaveLength(0);
    expect(await db.select().from(schema.matchRosters).where(eq(schema.matchRosters.matchId, match.id))).toHaveLength(0);
    expect((await db.query.eventRosterMembers.findFirst({ where: eq(schema.eventRosterMembers.id, member.id) }))?.isPrimaryStarter).toBe(false);
    expect(await db.query.matches.findFirst({ where: eq(schema.matches.id, match.id) })).toEqual(match);
  } finally { capture.mockRestore(); }
});

it("refreshes committed lineups despite a real later proposal SELECT failure, then preserves confirmed lineups on recovery", async () => {
  const fixture = await seedFixture({ matchStatus: "scheduled", freezeEventRoster: true });
  auth.userId = (await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, fixture.entryAId) }))!.representativeUserId;
  const [match] = await db.insert(schema.matches).values({ seasonId: fixture.seasonId,
    entryAId: fixture.entryAId, entryBId: fixture.entryBId, stage: "fixture-postcommit",
    status: "scheduled", scheduledAt: new Date(Date.now() + 60_000) }).returning();
  const pool = createLocalPool();
  const name = `postcommit_${randomUUID().replaceAll("-", "")}`;
  const capture = vi.spyOn(observability, "captureException");
  vi.mocked(revalidateMatchPaths).mockClear();
  try {
    // Rename only in the final lineup audit INSERT: that transaction commits
    // both lineups first, and the next real proposal query fails with 42P01.
    // This worker DB is disposable and isolated from other integration files.
    await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='match.roster.system_default' AND NEW.meta->>'matchId'='${match.id}'
        AND NEW.meta->>'entryId'='${fixture.entryBId}' THEN
        ALTER TABLE public.match_time_proposals RENAME TO ${name};
      END IF; RETURN NEW; END $$`);
    await pool.query(`CREATE TRIGGER ${name} AFTER INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    const failed = await runSchedulerJobManually({ jobKey: "match-time-auto-award" });
    expect(failed).toMatchObject({ success: false, error: { code: "INTERNAL_ERROR", requestId: expect.any(String) } });
    if (failed.success) throw new Error("expected post-commit failure");
    expect(failed.error.message).toContain("首发已保存");
    expect(failed.error.message).toContain("恢复后");
    expect(failed.error.message).not.toContain("match_time_proposals");
    const failure = capture.mock.calls.findLast(([event]) => event === "action.unexpected_error")!;
    expect(extractPgError(failure[1])?.code).toBe("42P01");
    const logged = capture.mock.results[capture.mock.calls.indexOf(failure)]!.value as StructuredEvent;
    expect(logged).toMatchObject({ errorCode: "42P01", requestId: failed.error.requestId, safeContext: { phase: "proposal_read_after_lineups" } });
    expect(JSON.stringify(logged)).not.toMatch(/match_time_proposals|SELECT|params/);
    expect(revalidateMatchPaths).toHaveBeenCalledWith(fixture.seasonId, match.id, { mode: "route" });
    const rosters = await db.select().from(schema.matchRosters).where(eq(schema.matchRosters.matchId, match.id));
    expect(rosters).toHaveLength(2);
    for (const roster of rosters) await db.transaction(tx => confirmMatchRosterInTx(tx, { rosterId: roster.id, actorId: auth.userId }));
    const confirmed = await db.select().from(schema.matchRosters).where(eq(schema.matchRosters.matchId, match.id));
    const players = await db.select().from(schema.matchRosterPlayers).where(inArray(schema.matchRosterPlayers.rosterId, confirmed.map(row => row.id)));
    const audit = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.seasonId, fixture.seasonId));
    await pool.query(`ALTER TABLE public.${name} RENAME TO match_time_proposals`);
    await pool.query(`DROP TRIGGER ${name} ON audit_logs`);
    vi.mocked(revalidateMatchPaths).mockClear();
    expect(await runSchedulerJobManually({ jobKey: "match-time-auto-award" })).toMatchObject({ success: true, data: { businessTransitions: 0 } });
    // A successful rerun skips existing rosters, so it cannot repair an earlier
    // lost invalidation. The failing run above must have refreshed the target.
    expect(revalidateMatchPaths).not.toHaveBeenCalled();
    expect(await db.select().from(schema.matchRosters).where(eq(schema.matchRosters.matchId, match.id))).toEqual(confirmed);
    expect(await db.select().from(schema.matchRosterPlayers).where(inArray(schema.matchRosterPlayers.rosterId, confirmed.map(row => row.id)))).toEqual(players);
    expect((await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.seasonId, fixture.seasonId))).filter(row => row.action !== "scheduler.manual_trigger")).toEqual(audit.filter(row => row.action !== "scheduler.manual_trigger"));
    expect(await db.query.matches.findFirst({ where: eq(schema.matches.id, match.id) })).toEqual(match);
    const page = await loadAdminMatchWorkbench({ seasonSlug: fixture.seasonId, matchId: match.id });
    expect(page?.teamARoster?.starters).toHaveLength(5);
    expect(page?.teamBRoster?.starters).toHaveLength(5);
  } finally {
    await pool.query(`DROP TRIGGER IF EXISTS ${name} ON audit_logs`);
    if ((await pool.query("SELECT to_regclass($1) AS present", [`public.${name}`])).rows[0].present) {
      await pool.query(`ALTER TABLE public.${name} RENAME TO match_time_proposals`);
    }
    await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
    await pool.end(); capture.mockRestore();
  }
});
