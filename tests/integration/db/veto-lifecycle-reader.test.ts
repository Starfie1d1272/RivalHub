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
    expect(await rows(f)).toEqual(original);
    const room = await view(f);
    expect(room.permissions.canRewind).toBe(false);
    expect(room.incidents[0]).toMatchObject({ mayAppeal: false, appeal: { mayResolve: false } });
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
