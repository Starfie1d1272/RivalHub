import type { TournamentMapFacts, TournamentPerformanceMapFacts, TournamentTeamConversionCount } from "@cs2dak/tournament";
import type { RivalHubDemoEvidenceV1 } from "@/lib/demo-evidence/contract";
import { isCurrentDakSemanticProfile } from "@/lib/demo-integration/semantic-profile";

/** Identity bindings come from RivalHub's gameplay resolver and effective MatchRoster. */
export interface StatsPlayerBinding { userId: string; entryId: string }

export function adaptStatsEvidence(evidence: RivalHubDemoEvidenceV1, bindings: ReadonlyMap<string, StatsPlayerBinding>): {
  tournament: TournamentMapFacts;
  performance: TournamentPerformanceMapFacts;
} {
  if (!isCurrentDakSemanticProfile(evidence.contract.semanticProfile)) throw new Error("Unsupported stats semantic profile");
  const teamEntityKeys = { teamA: evidence.target.entryAId, teamB: evidence.target.entryBId };
  const seen = new Set<string>();
  for (const participant of evidence.participants) {
    const binding = bindings.get(participant.steamId64);
    if (!binding || binding.entryId !== teamEntityKeys[participant.observedTeamKey] || seen.has(binding.userId)) {
      throw new Error("Ambiguous stats participant identity");
    }
    seen.add(binding.userId);
  }
  const player = (steam: string) => {
    const binding = bindings.get(steam);
    if (!binding || !seen.has(binding.userId)) throw new Error("Missing stats participant identity");
    return binding;
  };
  const common = {
    semanticProfile: evidence.contract.semanticProfile,
    analysisVersion: evidence.contract.analysisVersion,
    mapKey: evidence.target.matchMapId,
    matchKey: evidence.target.matchId,
    mapName: evidence.source.mapName,
    teamEntityKeys,
  };
  const teamMaps = Object.fromEntries(evidence.summaries.teamMaps.map(({ teamKey, ...facts }) => [teamKey, facts])) as TournamentMapFacts["teamMaps"];
  const teamConversions = Object.fromEntries(evidence.semanticFacts.teamConversions.map(({ teamKey, manAdvantage, ...facts }) => [teamKey, {
    ...facts,
    manAdvantage: Object.fromEntries(manAdvantage.map(({ advantage, ...count }) => [advantage, count])) as TournamentTeamConversionCount["manAdvantage"],
  }])) as TournamentMapFacts["teamConversions"];
  const playerWeapons = evidence.summaries.playerWeapons.map(({ steamId64, ...facts }) => ({
    ...facts, playerEntityKey: player(steamId64).userId, teamEntityKey: player(steamId64).entryId,
  }));
  // Economy classification is frozen by DAK; no local pistol detection.
  const pistolSides = { t: { opportunities: 0, wins: 0 }, ct: { opportunities: 0, wins: 0 } };
  for (const round of evidence.sourceFacts.rounds) {
    if (round.teamAEconomy !== "pistol" || round.teamBEconomy !== "pistol") continue;
    pistolSides.t.opportunities += 1;
    pistolSides.ct.opportunities += 1;
    pistolSides[round.winnerSide].wins += 1;
  }
  const rounds = new Map(evidence.sourceFacts.rounds.map((round) => [round.roundSeq, round]));
  const playerRounds: TournamentPerformanceMapFacts["playerRounds"] = evidence.semanticFacts.playerRounds.map(({ steamId64, teamKey, utility, clutch, ...facts }) => ({
    roundSeq: facts.roundSeq, side: facts.side, survived: facts.survived, kills: facts.kills, deaths: facts.deaths, assists: facts.assists, damage: facts.damage, headshots: facts.headshots, tradeKills: facts.tradeKills, tradedDeaths: facts.tradedDeaths, openingDuel: facts.openingDuel, kast: facts.kast,
    playerEntityKey: player(steamId64).userId,
    teamEntityKey: player(steamId64).entryId,
    teamWonRound: rounds.get(facts.roundSeq)!.winnerTeamKey === teamKey,
    clutch: clutch ? { ...clutch, opponentCount: clutch.opponentCount as 1 | 2 | 3 | 4 | 5 } : null,
    utility: { ...utility, utilityDamage: utility.heDamage + utility.fireDamage },
  }));
  const objectives: TournamentPerformanceMapFacts["objectives"] = evidence.sourceFacts.objectives.flatMap((fact) => {
    if (fact.type !== "planted" && fact.type !== "defused") return [];
    const binding = fact.actorSteamId64 ? player(fact.actorSteamId64) : null;
    const round = rounds.get(fact.roundSeq)!;
    const teamKey = binding ? binding.entryId === teamEntityKeys.teamA ? "teamA" : "teamB" : null;
    return [{ roundSeq: fact.roundSeq, type: fact.type, playerEntityKey: binding?.userId ?? null, teamEntityKey: binding?.entryId ?? null,
      side: teamKey === "teamA" ? round.teamASide : teamKey === "teamB" ? round.teamBSide : null,
      teamWonRound: teamKey ? round.winnerTeamKey === teamKey : null }];
  });
  return {
    tournament: { ...common, teamMaps, teamConversions, economyMatrix: evidence.semanticFacts.economyMatrix, pistolSides, playerWeapons },
    performance: { ...common, playerRounds, objectives, playerWeapons },
  };
}
