import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
// Future immutable producer build; production remains reader1/publisher0.
vi.mock("@/lib/matches/veto-room/lifecycle-contract.json", () => ({ default: { readerVersion: 1, publisherVersion: 1 } }));
vi.mock("@/lib/revalidation", () => ({ revalidateMatchPaths: vi.fn(), revalidatePublicSeasonTags: vi.fn(), revalidatePublicStatsTag: vi.fn(), revalidateSeasonPaths: vi.fn() }));
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { lockMatchInTx } from "@/lib/matches/locking";
import { startCanonicalMapInTx } from "@/lib/matches/map-start";
import { recordCanonicalMapResultInTx } from "@/lib/matches/results";
import { readVetoRoomSnapshot, reconcileVetoRoom, resolveVetoAppeal, rewindVetoRoom, submitVetoAppeal } from "@/lib/matches/veto-room/service";
import { projectVetoRoomView } from "@/lib/matches/veto-room/read-model";
import { VETO_APPEAL_CLOSURE_NOTE } from "@/lib/matches/veto-room/appeal-lifecycle";
import { seedFixture, NOW } from "./harness/mizar";
import { createLocalPool } from "./harness/database";
import { runMatchVetoTimeoutJob } from "@/lib/scheduler/runners";

// Real match locks, enum/check constraints, scheduler SQL and outbox behavior
// cannot be proven by a resolver mock or a UI test.
async function fixture() {
  const f = await seedFixture();
  const entry = await db.query.competitionEntries.findFirst({ where: eq(schema.competitionEntries.id, f.entryAId) });
  const actorId = entry!.representativeUserId;
  const [incident] = await db.insert(schema.matchVetoTimeoutIncidents).values({ matchId: f.matchId, turnKey: "ban-veto-a-opening", entryId: f.entryAId, representativeUserId: actorId, deadlineAt: NOW, resolvedAt: NOW, eligibleOptions: ["de_ancient", "de_mirage"], selectedOptions: ["de_mirage"] }).returning();
  return { ...f, actorId, incident: incident! };
}
async function submit(f: Awaited<ReturnType<typeof fixture>>) {
  await submitVetoAppeal({ matchId: f.matchId, incidentId: f.incident.id, actorId: f.actorId, reason: "请求核对平台超时证据" });
}
async function start(f: Awaited<ReturnType<typeof fixture>>) {
  await db.transaction(async tx => {
    await lockMatchInTx(tx, f.matchId);
    await startCanonicalMapInTx(tx, f.matchId, f.mapOneId, "mizar:test-machine");
  });
}
async function appeals(f: Awaited<ReturnType<typeof fixture>>) {
  return db.select().from(schema.matchVetoAppeals).where(eq(schema.matchVetoAppeals.timeoutIncidentId, f.incident.id));
}

describe("BP appeal gameplay lifecycle", () => {
  it.each(["cancelled", "finished"] as const)("keeps a non-restoring admin resolution for an unplayed %s match", async status => {
    const f = await fixture();
    await submit(f);
    const originalMaps = await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.matchId));
    await db.update(schema.matches).set({ status, isForfeit: status === "finished", ...(status === "finished" ? { scoreA: 2, scoreB: 0 } : {}) }).where(eq(schema.matches.id, f.matchId));
    expect(await reconcileVetoRoom(f.matchId)).toBe("idempotent");
    const snapshot = await readVetoRoomSnapshot(f.matchId);
    const adminView = await projectVetoRoomView(snapshot, f.actorId, { userId: f.actorId, email: "admin@local.test", role: "super_admin", seasonIds: [] });
    expect(adminView.incidents[0]!.appeal).toMatchObject({ statusLabel: "待裁定", mayResolve: true });
    expect(adminView.permissions.canRewind).toBe(false);
    const participantView = await projectVetoRoomView(snapshot, f.actorId, { userId: f.actorId, email: "participant@local.test", role: "user", seasonIds: [] });
    expect(participantView.incidents[0]!.appeal!.mayResolve).toBe(false);
    expect(participantView.incidents[0]!.mayAppeal).toBe(false);
    const appeal = (await appeals(f))[0]!;
    await expect(resolveVetoAppeal({ matchId: f.matchId, appealId: appeal.id, actorId: f.actorId, resolutionScope: "platform_or_organizer", resolutionNote: "不能恢复已结束比赛" })).rejects.toThrow("不能恢复");
    expect((await appeals(f))[0]!.status).toBe("pending");
    await resolveVetoAppeal({ matchId: f.matchId, appealId: appeal.id, actorId: f.actorId, resolutionScope: "participant_or_unverified", resolutionNote: "比赛未正式开赛已结束，记录处理说明，不恢复 BP" });
    expect((await appeals(f))[0]).toMatchObject({ status: "rejected", resolvedBy: f.actorId, resolutionScope: "participant_or_unverified" });
    expect(await db.select().from(schema.matchMaps).where(eq(schema.matchMaps.matchId, f.matchId))).toEqual(originalMaps);
    expect(await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, f.matchId), eq(schema.auditLogs.action, "match.veto.appeal_close")))).toHaveLength(0);
  });

  it("keeps the BP-complete recovery window open, closes atomically on actual start and preserves history", async () => {
    const f = await fixture();
    await submit(f);
    expect(await reconcileVetoRoom(f.matchId)).toBe("idempotent");
    expect((await appeals(f))[0]!.status).toBe("pending");
    const historicalId = randomUUID();
    await db.insert(schema.matchVetoAppeals).values({ id: historicalId, timeoutIncidentId: f.incident.id, submittedBy: f.actorId, reason: "历史申诉", status: "rejected", resolutionScope: "participant_or_unverified", resolvedBy: f.actorId, resolutionNote: "原人工裁定", resolvedAt: NOW });
    await start(f);
    await start(f);
    const rows = await appeals(f);
    expect(rows.find(row => row.id !== historicalId)).toMatchObject({ status: "closed", reason: "请求核对平台超时证据", resolutionScope: null, resolvedBy: null, resolutionNote: VETO_APPEAL_CLOSURE_NOTE });
    expect(rows.find(row => row.id === historicalId)).toMatchObject({ status: "rejected", resolvedBy: f.actorId, resolutionNote: "原人工裁定", resolvedAt: NOW });
    const audit = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, f.matchId), eq(schema.auditLogs.action, "match.veto.appeal_close")));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: "system:veto-appeal-lifecycle", meta: { reason: "gameplay_started" } });
    expect(await db.query.matchVetoTimeoutIncidents.findFirst({ where: eq(schema.matchVetoTimeoutIncidents.id, f.incident.id) })).toEqual(f.incident);
    await expect(submit(f)).rejects.toThrow("联系赛事管理员");
    await expect(rewindVetoRoom({ matchId: f.matchId, actorId: f.actorId, targetTurnKey: "choose-veto-team-a", reason: "不得恢复已开赛 BP" })).rejects.toThrow("不能恢复");
  });

  it("closes when a formal result is the first evidence of gameplay", async () => {
    const f = await fixture();
    await submit(f);
    await db.transaction(tx => recordCanonicalMapResultInTx(tx, { matchId: f.matchId, mapOrder: 1, mapName: "de_ancient", scoreA: 13, scoreB: 9, pickedByEntryId: null, teamAStartSide: null, actorId: f.actorId }));
    expect((await appeals(f))[0]!.status).toBe("closed");
  });

  it("recovers existing pending records from canonical gameplay facts and disables the scheduler due signal afterward", async () => {
    const f = await fixture();
    await submit(f);
    const pool = createLocalPool();
    try {
      expect((await pool.query("SELECT public.scheduler_job_is_due('resolve-match-veto-timeouts') AS due")).rows[0].due).toBe(false);
      await db.update(schema.matchMaps).set({ startedAt: NOW }).where(eq(schema.matchMaps.id, f.mapOneId));
      expect((await pool.query("SELECT public.scheduler_job_is_due('resolve-match-veto-timeouts') AS due")).rows[0].due).toBe(true);
      expect(await runMatchVetoTimeoutJob()).toMatchObject({ result: { changed: 1 }, businessTransitions: 1 });
      expect(await reconcileVetoRoom(f.matchId)).toBe("idempotent");
      expect((await appeals(f))[0]!.status).toBe("closed");
      expect((await pool.query("SELECT public.scheduler_job_is_due('resolve-match-veto-timeouts') AS due")).rows[0].due).toBe(false);
    } finally { await pool.end(); }
  });

  it("serializes concurrent submission and actual start so no pending appeal survives", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([submit(f), start(f)]);
    expect(results[1]!.status).toBe("fulfilled");
    const rows = await appeals(f);
    expect(rows.every(row => row.status === "closed")).toBe(true);
    if (results[0]!.status === "fulfilled") expect(rows).toHaveLength(1);
    else expect(rows).toHaveLength(0);
    await expect(submit(f)).rejects.toThrow("联系赛事管理员");
  });

  it.each(["finished", "cancelled"] as const)("rejects new recovery requests for %s matches without gameplay", async status => {
    const f = await fixture();
    await db.update(schema.matches).set({ status }).where(eq(schema.matches.id, f.matchId));
    await expect(submit(f)).rejects.toThrow("联系赛事管理员");
    expect(await appeals(f)).toHaveLength(0);
  });
});
