import type { TournamentPerformanceAnalytics } from "@cs2dak/tournament";
import type { RivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import type { StatsPlayerBinding } from "./evidence-adapter";

export const RECORD_NAMES = {
  kills: "单图最多击杀", adr: "单图最高 ADR", firstKills: "单图最多首杀",
  tradeKills: "单图最多补枪", clutch: "最大成功残局", economy: "最大经济翻盘",
  fourKills: "单图最多 4K", aces: "单图最多 Ace", utilityDamage: "单回合最高道具伤害",
  fourKillsTotal: "范围内累计 4K", acesTotal: "范围内累计 Ace",
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
  events?: CompactRecordEvent[];
  eventCounts?: Record<RecordEventKind, number>;
  multiKills?: { entityId: string; entryId: string; fourKills: number; aces: number }[];
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
  const eventFacts = collectRecordEvents(evidence, bindings);
  if (eventFacts) {
    for (const player of eventFacts.multiKills) {
      for (const kind of ["fourKills", "aces"] as const) {
        if (player[kind] > 0) candidates.push({ kind, entityId: player.entityId, entryId: player.entryId, numerator: player[kind], denominator: 1 });
      }
    }
    if (evidence.quality.capabilities.utility === "available") for (const row of evidence.semanticFacts.playerRounds) {
      const damage = row.utility.heDamage + row.utility.fireDamage;
      const binding = bindings.get(row.steamId64)!;
      if (damage > 0) candidates.push({ kind: "utilityDamage", entityId: binding.userId, entryId: binding.entryId, numerator: damage, denominator: 1, round: row.roundSeq });
    }
  }
  // Retain all local ties: scope filters select maps, never arbitrary player/round subsets.
  const compact = (Object.keys(RECORD_NAMES) as RecordKind[]).flatMap((kind) => {
    const rows = candidates.filter((c) => c.kind === kind);
    if (!rows.length) return [];
    const best = rows.reduce((a, b) => compareRecordValue(a, b) >= 0 ? a : b);
    return rows.filter((r) => compareRecordValue(r, best) === 0);
  });
  return { equipmentSampling, economyKnownRounds, candidates: compact, ...eventFacts };
}
export function compareRecordValue(a: Pick<RecordCandidate, "numerator" | "denominator">, b: Pick<RecordCandidate, "numerator" | "denominator">): number {
  // Canonical integer damage/rounds: exact rational equality avoids display-rounded ties.
  return a.numerator * b.denominator - b.numerator * a.denominator;
}


export const RECORD_EVENT_NAMES = {
  fourKill: "4K", ace: "Ace", zeus: "电击枪", knife: "刀杀", he: "HE 击杀", fire: "燃烧击杀",
  rare: "罕见武器", teamKill: "TK", suicide: "自杀", world: "环境致死",
} as const;
export type RecordEventKind = keyof typeof RECORD_EVENT_NAMES;
export interface CompactRecordEvent {
  id: string; kind: RecordEventKind; entityId: string; entryId: string;
  round: number; scoreA: number; scoreB: number; weapon?: string; victimId?: string;
  weapons?: string[];
}
const knifeNames = new Set([
  "knife", "knife_t", "bayonet", "knife_css", "knife_flip", "knife_gut", "knife_karambit", "knife_m9_bayonet",
  "knife_tactical", "knife_falchion", "knife_survival_bowie", "knife_butterfly", "knife_push", "knife_cord",
  "knife_canis", "knife_ursus", "knife_gypsy_jackknife", "knife_outdoor", "knife_stiletto", "knife_widowmaker", "knife_skeleton", "knife_kukri",
]);
const rareWeapons = new Set(["p90", "negev", "scar20", "g3sg1", "nova", "xm1014", "mag7", "sawedoff", "mp5sd", "m249", "bizon"]);
export function normalizeRecordWeapon(weapon: string): string {
  return weapon.trim().toLowerCase().replace(/^(weapon_|item_)/, "");
}
/** Full occurrences, separate from extrema. Stable/3 playerRounds count enemy kills. */
export function collectRecordEvents(evidence: RivalHubDemoEvidenceV1, bindings: ReadonlyMap<string, StatsPlayerBinding>) {
  if (evidence.contract.semanticProfile !== "dak-stable/3") return undefined;
  const events: CompactRecordEvent[] = [];
  const rounds = new Map(evidence.sourceFacts.rounds.map(r => [r.roundSeq, r]));
  const participants = new Map(evidence.participants.map(p => [p.steamId64, p]));
  const enemyWeapons = new Map<string, Set<string>>();
  for (const [index, kill] of evidence.sourceFacts.kills.entries()) {
    const weapon = normalizeRecordWeapon(kill.weapon);
    const killer = kill.killerSteamId64 ? participants.get(kill.killerSteamId64) : undefined;
    const victim = participants.get(kill.victimSteamId64)!;
    const environment = !killer || ["c4", "planted_c4", "world", "worldspawn", "trigger_hurt"].includes(weapon);
    const suicide = !environment && kill.killerSteamId64 === kill.victimSteamId64;
    const teamKill = !environment && !suicide && killer!.observedTeamKey === victim.observedTeamKey;
    let kind: RecordEventKind | undefined;
    if (environment) kind = "world";
    else if (suicide) kind = "suicide";
    else if (teamKill) kind = "teamKill";
    else {
      const key = `${kill.roundSeq}:${kill.killerSteamId64}`;
      const weapons = enemyWeapons.get(key) ?? new Set<string>();
      weapons.add(weapon); enemyWeapons.set(key, weapons);
      if (weapon === "taser") kind = "zeus";
      else if (knifeNames.has(weapon)) kind = "knife";
      else if (weapon === "hegrenade") kind = "he";
      else if (["inferno", "molotov", "incgrenade"].includes(weapon)) kind = "fire";
      else if (rareWeapons.has(weapon)) kind = "rare";
    }
    if (!kind) continue;
    const binding = bindings.get(environment ? kill.victimSteamId64 : kill.killerSteamId64!)!;
    const round = rounds.get(kill.roundSeq)!;
    events.push({ id: `kill:${index}`, kind, entityId: binding.userId, entryId: binding.entryId, round: round.roundSeq,
      scoreA: round.teamAScoreBefore, scoreB: round.teamBScoreBefore, weapon,
      victimId: bindings.get(kill.victimSteamId64)!.userId });
  }
  const multiKills = new Map<string, { entityId: string; entryId: string; fourKills: number; aces: number }>();
  for (const row of evidence.semanticFacts.playerRounds) {
    if (row.kills !== 4 && row.kills !== 5) continue;
    const binding = bindings.get(row.steamId64)!;
    const kind = row.kills === 4 ? "fourKill" : "ace";
    const round = rounds.get(row.roundSeq)!;
    events.push({ id: `multi:${row.roundSeq}:${binding.userId}`, kind, entityId: binding.userId, entryId: binding.entryId,
      round: row.roundSeq, scoreA: round.teamAScoreBefore, scoreB: round.teamBScoreBefore,
      weapons: [...(enemyWeapons.get(`${row.roundSeq}:${row.steamId64}`) ?? [])].sort() });
    const totals = multiKills.get(binding.userId) ?? { entityId: binding.userId, entryId: binding.entryId, fourKills: 0, aces: 0 };
    if (kind === "fourKill") totals.fourKills++; else totals.aces++;
    multiKills.set(binding.userId, totals);
  }
  const eventCounts = Object.fromEntries(Object.keys(RECORD_EVENT_NAMES).map(kind => [kind, 0])) as Record<RecordEventKind, number>;
  for (const event of events) eventCounts[event.kind]++;
  return { events, eventCounts, multiKills: [...multiKills.values()] };
}
