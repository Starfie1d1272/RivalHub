import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/revalidation", () => ({ revalidateMatchPaths: vi.fn(), revalidatePublicSeasonTags: vi.fn(), revalidatePublicStatsTag: vi.fn(), revalidateSeasonPaths: vi.fn() }));
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { loadBetFacts } from "@/lib/bet/facts";
import { lockMatchInTx } from "@/lib/matches/locking";
import { startCanonicalMapInTx } from "@/lib/matches/map-start";
import { recordCanonicalMapResultInTx } from "@/lib/matches/results";
import { closeVetoAppealsAfterGameplayInTx, VETO_APPEAL_CLOSURE_NOTE } from "@/lib/matches/veto-room/appeal-lifecycle";
import { canPublishVetoAppealClosure } from "@/lib/matches/veto-room/lifecycle-publication";
import { projectVetoRoomView } from "@/lib/matches/veto-room/read-model";
import { readVetoRoomCore, readVetoRoomSnapshot, reconcileVetoRoom, resolveVetoAppeal, rewindVetoRoom, submitVetoAppeal } from "@/lib/matches/veto-room/service";
import { runMatchVetoTimeoutJob } from "@/lib/scheduler/runners";
import { createLocalPool } from "./harness/database";
import { dispatchCommand } from "../../../scripts/db/scheduler";
import { getSchedulerJobDefinition } from "@/lib/scheduler/definitions";
import { seedFixture, NOW } from "./harness/mizar";

// Real default build + PG locks/facts: publication cannot authorize recovery,
// and retaining legacy pending history must not stall normal match/BET business.
async function fixture() {
  const f = await seedFixture({ freezeEventRoster: true });
  const entry = await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, f.entryAId) });
  const actorId = entry!.representativeUserId;
  await db.update(schema.users).set({ role: "super_admin" }).where(eq(schema.users.id, actorId));
  const [incident] = await db.insert(schema.matchVetoTimeoutIncidents).values({ matchId: f.matchId, turnKey: "ban-veto-a-opening", entryId: f.entryAId, representativeUserId: actorId, deadlineAt: NOW, resolvedAt: NOW, eligibleOptions: ["de_ancient", "de_mirage"], selectedOptions: ["de_mirage"] }).returning();
  return { ...f, actorId, incident: incident! };
}
type F = Awaited<ReturnType<typeof fixture>>;
const rows = (f: F) => db.select().from(schema.matchVetoAppeals).where(eq(schema.matchVetoAppeals.timeoutIncidentId, f.incident.id));
const submit = (f: F) => submitVetoAppeal({ matchId: f.matchId, incidentId: f.incident.id, actorId: f.actorId, reason: "合成历史技术申诉" });
const start = (f: F) => db.transaction(async tx => { await lockMatchInTx(tx, f.matchId); await startCanonicalMapInTx(tx, f.matchId, f.mapOneId, f.actorId); });
const view = async (f: F) => projectVetoRoomView(await readVetoRoomSnapshot(f.matchId), f.actorId, { userId: f.actorId, email: "synthetic@local.test", role: "super_admin", seasonIds: [] });

describe("veto lifecycle shipped reader1/publisher0", () => {
  it.each(["timeout", "start"] as const)("still admits ordinary %s dispatch with the closure producer disabled", async kind => {
    const f = await fixture();
    const pool = createLocalPool();
    try {
      if (kind === "timeout") {
        await db.update(schema.matchVetoSessions).set({ completedAt: null, turnStartedAt: NOW, turnDeadlineAt: new Date(Date.now() - 60_000) }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
      } else {
        await db.update(schema.matches).set({ status: "scheduled", scheduledAt: NOW }).where(eq(schema.matches.id, f.matchId));
        await db.update(schema.matchVetoSessions).set({ startedAt: null, completedAt: null, entryAStartRequestedAt: NOW, entryAStartRequestedBy: f.actorId }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
      }
      expect((await pool.query("SELECT public.scheduler_job_is_due('resolve-match-veto-timeouts', false) AS due")).rows[0].due).toBe(true);
      // Real dispatch must reach enqueue. Provider-enabled local DBs can enqueue;
      // plain PG17 reaches its real missing-provider error. Roll back so a test
      // never commits an HTTP request using any preexisting local Vault config.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        try {
          expect((await client.query(dispatchCommand(getSchedulerJobDefinition("resolve-match-veto-timeouts")!))).rows[0].dispatch_rivalhub_scheduler_job).not.toBeNull();
        } catch (error) {
          expect(["0A000", "22023"]).toContain((error as { code: string }).code);
          expect((error as Error).message).toMatch(/^scheduler (vault|credentials|HTTP extension) (is|are) unavailable$/);
        }
      } finally { await client.query("ROLLBACK"); client.release(); }
    } finally {
      await db.update(schema.matchVetoSessions).set({ startedAt: NOW, completedAt: NOW, turnStartedAt: null, turnDeadlineAt: null, entryAStartRequestedAt: null, entryAStartRequestedBy: null }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
      await db.update(schema.matches).set({ status: "in_progress" }).where(eq(schema.matches.id, f.matchId));
      await pool.end();
    }
  });

  it("starts normally without publishing closed, but all recovery/adjudication owners independently reject gameplay", async () => {
    expect(canPublishVetoAppealClosure()).toBe(false);
    const f = await fixture(); await submit(f);
    const original = await rows(f);
    expect((await db.transaction(tx => loadBetFacts(tx, f.seasonId))).vetoByMatch.get(f.matchId)!.pendingAppeal).toBe(true);
    await start(f); await start(f);
    const maps = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.matchId));
    expect(maps.find(m => m.id === f.mapOneId)!.startedAt).not.toBeNull();
    await readVetoRoomCore(f.matchId); await reconcileVetoRoom(f.matchId);
    expect(await runMatchVetoTimeoutJob()).toMatchObject({ result: { processed: 0, changed: 0 } });
    const pool = createLocalPool();
    try {
      expect((await pool.query("SELECT public.scheduler_job_is_due('resolve-match-veto-timeouts') AS due")).rows[0].due).toBe(false);
      expect((await pool.query("SELECT public.scheduler_job_is_due('resolve-match-veto-timeouts', false) AS due")).rows[0].due).toBe(false);
      const command = dispatchCommand(getSchedulerJobDefinition("resolve-match-veto-timeouts")!);
      for (let tick = 0; tick < 3; tick++) expect((await pool.query(command)).rows[0].dispatch_rivalhub_scheduler_job).toBeNull();
      const health = (await pool.query("SELECT last_primary_triggered_at, last_primary_dispatch_requested_at, last_primary_endpoint_succeeded_at FROM scheduled_job_health WHERE job_key='resolve-match-veto-timeouts'")).rows[0];
      expect(health.last_primary_triggered_at).not.toBeNull();
      expect(health.last_primary_dispatch_requested_at).toBeNull();
      expect(health.last_primary_endpoint_succeeded_at).toBeNull();
    } finally { await pool.end(); }
    expect(await rows(f)).toEqual(original);
    const room = await view(f);
    expect(room.permissions.canRewind).toBe(false);
    expect(room.incidents[0]).toMatchObject({ mayAppeal: false, appeal: { mayResolve: false, statusLabel: "恢复窗口已结束（原待处理记录保留）" } });
    for (const resolutionScope of ["platform_or_organizer", "participant_or_unverified"] as const) {
      await expect(resolveVetoAppeal({ matchId: f.matchId, appealId: original[0]!.id, actorId: f.actorId, resolutionScope, resolutionNote: "不能改写已结束的恢复窗口" })).rejects.toThrow("不能裁定或恢复");
    }
    await expect(rewindVetoRoom({ matchId: f.matchId, actorId: f.actorId, targetTurnKey: "choose-veto-team-a", reason: "不得抹除已开赛地图" })).rejects.toThrow("不能恢复 BP");
    await expect(submit(f)).rejects.toThrow("联系赛事管理员");
    expect(await rows(f)).toEqual(original);
    expect(await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.matchId))).toEqual(maps);
    expect((await db.transaction(tx => loadBetFacts(tx, f.seasonId))).vetoByMatch.get(f.matchId)!.pendingAppeal).toBe(false);
    expect(await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, f.matchId), eq(schema.auditLogs.action, "match.veto.appeal_close")))).toHaveLength(0);
  });

  it("reads a historical closed fact and preserves both it and prior human adjudication without enabling publication", async () => {
    const f = await fixture(); await start(f);
    await db.insert(schema.matchVetoAppeals).values({ timeoutIncidentId: f.incident.id, submittedBy: f.actorId, reason: "历史已结束申诉", status: "closed", resolvedAt: NOW, resolutionNote: VETO_APPEAL_CLOSURE_NOTE });
    const [humanIncident] = await db.insert(schema.matchVetoTimeoutIncidents).values({ ...f.incident, id: randomUUID(), turnKey: "historical-human" }).returning();
    await db.insert(schema.matchVetoAppeals).values({ timeoutIncidentId: humanIncident!.id, submittedBy: f.actorId, reason: "原人工申诉", status: "rejected", resolutionScope: "participant_or_unverified", resolvedBy: f.actorId, resolvedAt: NOW, resolutionNote: "原人工裁定不可覆盖" });
    const original = (await readVetoRoomSnapshot(f.matchId)).appeals.sort((a, b) => a.id.localeCompare(b.id));
    expect(await db.transaction(async tx => { await lockMatchInTx(tx, f.matchId); return closeVetoAppealsAfterGameplayInTx(tx, f.matchId); })).toBe(false);
    await readVetoRoomCore(f.matchId); await reconcileVetoRoom(f.matchId);
    expect((await readVetoRoomSnapshot(f.matchId)).appeals.sort((a, b) => a.id.localeCompare(b.id))).toEqual(original);
    const room = await view(f);
    expect(room.incidents.find(i => i.id === f.incident.id)!.appeal).toMatchObject({ statusLabel: "已结束（正式对局已开始）", mayResolve: false });
    expect(room.permissions.canRewind).toBe(false);
  });

  it("records the first formal result with legacy pending history intact and no active BP-recovery settlement hold", async () => {
    const f = await fixture(); await submit(f); const original = await rows(f);
    await db.transaction(tx => recordCanonicalMapResultInTx(tx, { matchId: f.matchId, mapOrder: 1, mapName: "de_ancient", scoreA: 13, scoreB: 9, pickedByEntryId: null, teamAStartSide: null, actorId: f.actorId }));
    expect(await rows(f)).toEqual(original);
    expect((await db.transaction(tx => loadBetFacts(tx, f.seasonId))).vetoByMatch.get(f.matchId)!.pendingAppeal).toBe(false);
    expect((await view(f)).permissions.canRewind).toBe(false);
  });
});
