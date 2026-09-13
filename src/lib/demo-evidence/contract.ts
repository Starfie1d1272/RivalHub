import { z } from "zod";

const uuidSchema = z.guid();
const steamId64Schema = z.string().regex(/^\d{17}$/, "Steam64 必须是 17 位数字");
const countSchema = z.number().int().nonnegative();
const tickSchema = z.number().int().nonnegative();
const teamKeySchema = z.enum(["teamA", "teamB"]);
const sideSchema = z.enum(["t", "ct"]);
const economySchema = z.enum(["pistol", "eco", "semi", "force", "full"]);
const availabilitySchema = z.enum(["available", "partial", "missing"]);

const winLossSchema = z.object({
  opportunities: countSchema,
  wins: countSchema,
}).strict().superRefine((value, ctx) => {
  if (value.wins > value.opportunities) {
    ctx.addIssue({ code: "custom", message: "wins 不能超过 opportunities" });
  }
});

const participantResolutionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("matched"),
    userId: uuidSchema,
    eventRosterMemberId: uuidSchema.optional(),
    entryId: uuidSchema,
  }).strict(),
  z.object({
    status: z.literal("unresolved"),
  }).strict(),
  z.object({
    status: z.literal("conflict"),
    userId: uuidSchema.optional(),
    eventRosterMemberId: uuidSchema.optional(),
    entryId: uuidSchema.optional(),
  }).strict(),
]);

export const rivalHubDemoEvidenceV1Schema = z.object({
  contract: z.object({
    contractVersion: z.literal("rivalhub-demo-evidence/1"),
    semanticProfile: z.string().regex(/^dak-stable\/\d+$/, "semanticProfile 必须是 dak-stable/<major>"),
    analysisVersion: z.string().min(1),
  }).strict(),
  target: z.object({
    seasonId: uuidSchema,
    stageKey: z.string().min(1),
    stageRunId: uuidSchema.optional(),
    matchId: uuidSchema,
    matchMapId: uuidSchema,
    mapOrder: z.number().int().positive().max(5),
    entryAId: uuidSchema,
    entryBId: uuidSchema,
    expectedMapName: z.string().min(1),
    evidenceRevision: z.string().min(1),
  }).strict().refine((value) => value.entryAId !== value.entryBId, "双方 Entry 不能相同"),
  source: z.object({
    demoSha256: z.string().regex(/^[a-f0-9]{64}$/),
    mapName: z.string().min(1),
    tickRateHz: z.number().int().positive(),
    sourceSchemaVersion: z.string().min(1),
    exporterVersion: z.string().min(1),
    parserVersion: z.string().min(1),
    assistantVersion: z.string().min(1),
    generatedAt: z.string().datetime(),
  }).strict(),
  quality: z.object({
    qa: z.object({
      ok: z.boolean(),
      issueCount: countSchema,
      errorCount: countSchema,
      warningCount: countSchema,
    }).strict(),
    capabilities: z.object({
      playerStats: availabilitySchema,
      rounds: availabilitySchema,
      economy: availabilitySchema,
      richKills: availabilitySchema,
      damages: availabilitySchema,
      bombs: availabilitySchema,
      utility: availabilitySchema,
      clutches: availabilitySchema,
    }).strict(),
  }).strict(),
  participants: z.array(z.object({
    steamId64: steamId64Schema,
    nameSnapshot: z.string().min(1),
    observedTeamKey: teamKeySchema,
    resolution: participantResolutionSchema,
  }).strict()).min(1),
  sourceFacts: z.object({
    rounds: z.array(z.object({
      roundSeq: z.number().int().positive(),
      sourceRoundNumber: z.number().int().positive(),
      phase: z.enum(["regulation", "overtime"]),
      startTick: tickSchema,
      freezeEndTick: tickSchema,
      endTick: tickSchema,
      teamASide: sideSchema,
      teamBSide: sideSchema,
      teamAScoreBefore: countSchema,
      teamBScoreBefore: countSchema,
      teamAEconomy: economySchema,
      teamBEconomy: economySchema,
      winnerTeamKey: teamKeySchema,
      winnerSide: sideSchema,
      endReason: z.string().min(1),
    }).strict()).min(1),
    kills: z.array(z.object({
      roundSeq: z.number().int().positive(),
      tick: tickSchema,
      killerSteamId64: steamId64Schema.nullable(),
      victimSteamId64: steamId64Schema,
      weapon: z.string().min(1),
      headshot: z.boolean(),
    }).strict()),
    objectives: z.array(z.object({
      roundSeq: z.number().int().positive(),
      tick: tickSchema,
      type: z.enum(["plant_begin", "planted", "defuse_begin", "defused", "exploded", "dropped", "picked_up"]),
      site: z.enum(["a", "b"]).nullable(),
      actorSteamId64: steamId64Schema.nullable(),
    }).strict()),
  }).strict(),
  semanticFacts: z.object({
    playerRounds: z.array(z.object({
      roundSeq: z.number().int().positive(),
      steamId64: steamId64Schema,
      teamKey: teamKeySchema,
      side: sideSchema,
      survived: z.boolean(),
      kills: countSchema,
      deaths: countSchema,
      assists: countSchema,
      damage: countSchema,
      headshots: countSchema,
      tradeKills: countSchema,
      tradedDeaths: countSchema,
      openingDuel: z.enum(["none", "won", "lost"]),
      kast: z.boolean(),
      economyType: economySchema.nullable(),
      equipmentValue: countSchema.nullable(),
      clutch: z.object({ opponentCount: z.number().int().min(1).max(5), won: z.boolean() }).strict().nullable(),
      utility: z.object({
        flashesThrown: countSchema,
        enemyBlindSeconds: z.number().nonnegative(),
        teamBlindSeconds: z.number().nonnegative(),
        enemyBlindVictims: countSchema,
        flashAssists: countSchema,
        heThrows: countSchema,
        heDamage: countSchema,
        fireThrows: countSchema,
        fireDamage: countSchema,
        smokesThrown: countSchema,
        utilityKills: countSchema,
      }).strict(),
    }).strict()).min(1),
    economyMatrix: z.array(z.object({
      lowEconomy: economySchema,
      highEconomy: economySchema,
      rounds: countSchema,
      lowEconomyWins: countSchema,
    }).strict()).min(1),
    teamConversions: z.array(z.object({
      teamKey: teamKeySchema,
      pistol: winLossSchema,
      round2: z.object({ conversion: winLossSchema, break: winLossSchema }).strict(),
      ecoSemiUpset: winLossSchema,
      manAdvantage: z.array(z.object({
        advantage: z.enum(["5v4", "4v5", "5v3", "3v5"]),
        opportunities: countSchema,
        wins: countSchema,
      }).strict()).length(4),
    }).strict()).length(2),
  }).strict(),
  summaries: z.object({
    playerMaps: z.array(z.object({
      steamId64: steamId64Schema,
      teamKey: teamKeySchema,
      rounds: countSchema,
      kills: countSchema,
      deaths: countSchema,
      assists: countSchema,
      damage: countSchema,
      kastRounds: countSchema,
      headshots: countSchema,
      firstKills: countSchema,
      firstDeaths: countSchema,
      tradeKills: countSchema,
      twoKillRounds: countSchema,
      threeKillRounds: countSchema,
      fourKillRounds: countSchema,
      fiveKillRounds: countSchema,
      clutchAttempts: countSchema,
      clutchWins: countSchema,
    }).strict()).min(1),
    playerWeapons: z.array(z.object({
      steamId64: steamId64Schema,
      weapon: z.string().min(1),
      kills: countSchema,
      headshotKills: countSchema,
    }).strict()),
    teamMaps: z.array(z.object({
      teamKey: teamKeySchema,
      rounds: countSchema,
      roundWins: countSchema,
      tRounds: countSchema,
      tWins: countSchema,
      ctRounds: countSchema,
      ctWins: countSchema,
    }).strict()).length(2),
  }).strict(),
  extensions: z.record(z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/), z.unknown()),
}).strict();

export type RivalHubDemoEvidenceV1 = z.infer<typeof rivalHubDemoEvidenceV1Schema>;

/** Parses the wire payload and checks relationships that JSON Schema cannot express. */
export function parseRivalHubDemoEvidenceV1(input: unknown): RivalHubDemoEvidenceV1 {
  const evidence = rivalHubDemoEvidenceV1Schema.parse(input);
  const participantBySteam = new Map<string, RivalHubDemoEvidenceV1["participants"][number]>();
  for (const participant of evidence.participants) {
    if (participantBySteam.has(participant.steamId64)) throw new Error("participants 不能重复 Steam64");
    participantBySteam.set(participant.steamId64, participant);
    if (participant.resolution.status === "matched" && participant.resolution.entryId !== evidence.target.entryAId && participant.resolution.entryId !== evidence.target.entryBId) {
      throw new Error("matched participant 的 entryId 必须属于 evidence target");
    }
  }

  const rounds = evidence.sourceFacts.rounds;
  if (evidence.source.mapName !== evidence.target.expectedMapName) throw new Error("source mapName 必须匹配 target expectedMapName");
  const roundBySeq = new Map(rounds.map((round) => [round.roundSeq, round]));
  if (roundBySeq.size !== rounds.length || rounds.some((round, index) => round.roundSeq !== index + 1)) {
    throw new Error("roundSeq 必须从 1 连续且唯一");
  }
  for (const kill of evidence.sourceFacts.kills) {
    if (!roundBySeq.has(kill.roundSeq) || !participantBySteam.has(kill.victimSteamId64) || (kill.killerSteamId64 !== null && !participantBySteam.has(kill.killerSteamId64))) {
      throw new Error("kill 引用了未知 round 或 participant");
    }
  }
  for (const objective of evidence.sourceFacts.objectives) {
    if (!roundBySeq.has(objective.roundSeq) || (objective.actorSteamId64 !== null && !participantBySteam.has(objective.actorSteamId64))) {
      throw new Error("objective 引用了未知 round 或 participant");
    }
  }

  const playerRoundByKey = new Map<string, RivalHubDemoEvidenceV1["semanticFacts"]["playerRounds"][number]>();
  for (const fact of evidence.semanticFacts.playerRounds) {
    const participant = participantBySteam.get(fact.steamId64);
    if (!roundBySeq.has(fact.roundSeq) || !participant || participant.observedTeamKey !== fact.teamKey) throw new Error("playerRound 引用了不匹配的 round 或 participant");
    const key = `${fact.roundSeq}:${fact.steamId64}`;
    if (playerRoundByKey.has(key)) throw new Error("playerRound 不能重复");
    playerRoundByKey.set(key, fact);
  }
  if (playerRoundByKey.size !== rounds.length * evidence.participants.length) throw new Error("normal V1 必须为每名 participant 提供每回合 playerRound");

  const playerSummaries = new Map(evidence.summaries.playerMaps.map((summary) => [summary.steamId64, summary]));
  if (playerSummaries.size !== evidence.participants.length) throw new Error("playerMaps 必须恰好覆盖每名 participant 一次");
  for (const participant of evidence.participants) {
    const summary = playerSummaries.get(participant.steamId64);
    if (!summary || summary.teamKey !== participant.observedTeamKey) throw new Error("playerMaps participant 映射无效");
    const facts = [...playerRoundByKey.values()].filter((fact) => fact.steamId64 === participant.steamId64);
    const total = (key: "kills" | "deaths" | "assists" | "damage" | "headshots" | "tradeKills") => facts.reduce((sum, fact) => sum + fact[key], 0);
    const exactMultiKills = (count: number) => facts.filter((fact) => fact.kills === count).length;
    const fiveKills = facts.filter((fact) => fact.kills >= 5).length;
    const clutchAttempts = facts.filter((fact) => fact.clutch !== null).length;
    const clutchWins = facts.filter((fact) => fact.clutch?.won).length;
    if (summary.rounds !== facts.length || summary.kills !== total("kills") || summary.deaths !== total("deaths") || summary.assists !== total("assists") || summary.damage !== total("damage") || summary.headshots !== total("headshots") || summary.tradeKills !== total("tradeKills") || summary.kastRounds !== facts.filter((fact) => fact.kast).length || summary.firstKills !== facts.filter((fact) => fact.openingDuel === "won").length || summary.firstDeaths !== facts.filter((fact) => fact.openingDuel === "lost").length || summary.twoKillRounds !== exactMultiKills(2) || summary.threeKillRounds !== exactMultiKills(3) || summary.fourKillRounds !== exactMultiKills(4) || summary.fiveKillRounds !== fiveKills || summary.clutchAttempts !== clutchAttempts || summary.clutchWins !== clutchWins) {
      throw new Error("playerMaps 与 playerRounds 不一致");
    }
  }
  const weaponFacts = new Map<string, { kills: number; headshotKills: number }>();
  for (const kill of evidence.sourceFacts.kills) {
    if (kill.killerSteamId64 === null) continue;
    const key = `${kill.killerSteamId64}:${kill.weapon}`;
    const row = weaponFacts.get(key) ?? { kills: 0, headshotKills: 0 };
    row.kills += 1;
    if (kill.headshot) row.headshotKills += 1;
    weaponFacts.set(key, row);
  }
  if (weaponFacts.size !== evidence.summaries.playerWeapons.length) throw new Error("playerWeapons 必须恰好覆盖 source kill weapon breakdown");
  for (const summary of evidence.summaries.playerWeapons) {
    const fact = weaponFacts.get(`${summary.steamId64}:${summary.weapon}`);
    if (!fact || fact.kills !== summary.kills || fact.headshotKills !== summary.headshotKills) throw new Error("playerWeapons 与 source kills 不一致");
  }
  const teamMaps = new Map(evidence.summaries.teamMaps.map((summary) => [summary.teamKey, summary]));
  if (teamMaps.size !== 2) throw new Error("teamMaps 必须覆盖双方各一次");
  for (const teamKey of ["teamA", "teamB"] as const) {
    const summary = teamMaps.get(teamKey)!;
    const sideFor = (round: RivalHubDemoEvidenceV1["sourceFacts"]["rounds"][number]) => teamKey === "teamA" ? round.teamASide : round.teamBSide;
    const teamRounds = rounds;
    const tRounds = teamRounds.filter((round) => sideFor(round) === "t");
    const ctRounds = teamRounds.filter((round) => sideFor(round) === "ct");
    if (summary.rounds !== rounds.length || summary.roundWins !== rounds.filter((round) => round.winnerTeamKey === teamKey).length || summary.tRounds !== tRounds.length || summary.tWins !== tRounds.filter((round) => round.winnerTeamKey === teamKey).length || summary.ctRounds !== ctRounds.length || summary.ctWins !== ctRounds.filter((round) => round.winnerTeamKey === teamKey).length) {
      throw new Error("teamMaps 与 source rounds 不一致");
    }
  }
  const conversionByTeam = new Map(evidence.semanticFacts.teamConversions.map((conversion) => [conversion.teamKey, conversion]));
  if (conversionByTeam.size !== 2 || !conversionByTeam.has("teamA") || !conversionByTeam.has("teamB")) {
    throw new Error("teamConversions 必须恰好覆盖双方各一次");
  }
  for (const conversion of evidence.semanticFacts.teamConversions) {
    const advantages = new Set(conversion.manAdvantage.map((row) => row.advantage));
    if (advantages.size !== 4 || !(["5v4", "4v5", "5v3", "3v5"] as const).every((key) => advantages.has(key))) {
      throw new Error("manAdvantage 必须恰好覆盖四种状态各一次");
    }
  }
  return evidence;
}
