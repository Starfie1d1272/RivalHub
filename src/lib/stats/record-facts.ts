import type { TournamentPerformanceAnalytics } from "@cs2dak/tournament";
import type { RivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import type { StatsPlayerBinding } from "./evidence-adapter";

export const RECORD_NAMES = {
  kills: "Most Kills in a Map", adr: "Highest ADR in a Map", firstKills: "Most First Kills in a Map",
  tradeKills: "Most Trade Kills in a Map", clutch: "Largest Clutch Won", economy: "Biggest Economy Upset",
} as const;
export type RecordKind = keyof typeof RECORD_NAMES;
export interface RecordCandidate {
  kind: RecordKind; entityId: string; entryId: string; numerator: number; denominator: number;
  round?: number; winnerEquipment?: number; loserEquipment?: number;
}
export interface CompactRecordFacts {
  equipmentSampling: "freezeEnd" | "unverified";
  economyKnownRounds: number;
  candidates: RecordCandidate[];
}
/** Freeze-end equipment semantics verified at cs2df v3.1.0 (0e3e6c71), not inferred from a nullable value. */
export function collectRecordFacts(evidence: RivalHubDemoEvidenceV1, bindings: ReadonlyMap<string, StatsPlayerBinding>, performance: TournamentPerformanceAnalytics): CompactRecordFacts {
  const candidates: RecordCandidate[] = [];
  const entryFor = (id: string) => [...bindings.values()].find((b) => b.userId === id)!.entryId;
  for (const player of performance.players) {
    const slice = player.slices.overall;
    if (slice.sample.rounds !== evidence.sourceFacts.rounds.length) continue;
    const base = { entityId: player.player.entityKey, entryId: entryFor(player.player.entityKey) };
    candidates.push({ ...base, kind: "kills", numerator: slice.combat.kills, denominator: 1 },
      { ...base, kind: "adr", numerator: slice.combat.damage, denominator: slice.sample.rounds },
      { ...base, kind: "firstKills", numerator: slice.opening.firstKills, denominator: 1 },
      { ...base, kind: "tradeKills", numerator: slice.trade.tradeKills, denominator: 1 });
  }
  for (const row of evidence.semanticFacts.playerRounds) {
    if (!row.clutch?.won) continue;
    const binding = bindings.get(row.steamId64)!;
    candidates.push({ kind: "clutch", entityId: binding.userId, entryId: binding.entryId, numerator: row.clutch.opponentCount, denominator: 1, round: row.roundSeq });
  }
  const equipmentSampling = evidence.source.exporterVersion === "cs2df/3.1.0" ? "freezeEnd" : "unverified";
  let economyKnownRounds = 0;
  if (equipmentSampling === "freezeEnd") {
    for (const round of evidence.sourceFacts.rounds) {
      const rows = evidence.semanticFacts.playerRounds.filter((r) => r.roundSeq === round.roundSeq);
      if (rows.length !== 10 || new Set(rows.map((r) => r.steamId64)).size !== 10
        || rows.some((r) => r.equipmentValue === null || !Number.isInteger(r.equipmentValue) || r.equipmentValue < 0)
        || rows.filter((r) => r.teamKey === "teamA").length !== 5 || rows.filter((r) => r.teamKey === "teamB").length !== 5) continue;
      economyKnownRounds++;
      const winnerEquipment = rows.filter((r) => r.teamKey === round.winnerTeamKey).reduce((s, r) => s + r.equipmentValue!, 0);
      const loserEquipment = rows.filter((r) => r.teamKey !== round.winnerTeamKey).reduce((s, r) => s + r.equipmentValue!, 0);
      if (loserEquipment <= winnerEquipment) continue;
      const entryId = round.winnerTeamKey === "teamA" ? evidence.target.entryAId : evidence.target.entryBId;
      candidates.push({ kind: "economy", entityId: entryId, entryId, numerator: loserEquipment - winnerEquipment, denominator: 1,
        round: round.roundSeq, winnerEquipment, loserEquipment });
    }
  }
  // Retain all local ties: scope filters select maps, never arbitrary player/round subsets.
  const compact = (Object.keys(RECORD_NAMES) as RecordKind[]).flatMap((kind) => {
    const rows = candidates.filter((c) => c.kind === kind);
    if (!rows.length) return [];
    const best = rows.reduce((a, b) => compareRecordValue(a, b) >= 0 ? a : b);
    return rows.filter((r) => compareRecordValue(r, best) === 0);
  });
  return { equipmentSampling, economyKnownRounds, candidates: compact };
}
export function compareRecordValue(a: Pick<RecordCandidate, "numerator" | "denominator">, b: Pick<RecordCandidate, "numerator" | "denominator">): number {
  // Canonical integer damage/rounds: exact rational equality avoids display-rounded ties.
  return a.numerator * b.denominator - b.numerator * a.denominator;
}
