import {
  playoffDescendants,
  type PlayoffManagedKey,
} from "@/lib/major/playoff-dependencies";
import { buildMajorOpeningPlan } from "@/lib/major/opening";
import {
  directSeedRange,
  seedMajorLaterStageEntrants,
} from "@/lib/major/seeding";
import {
  generateNextMajorSwissRound,
  getMajorSwissQualifiers,
  projectMajorSwissStage,
  type MajorSwissEntrant,
  type MajorSwissMatchFact,
} from "@/lib/major/swiss";
import {
  generateMajorPlayoffNextRound,
  type MajorPlayoffMatchFact,
} from "@/lib/major/playoff";
import {
  SIMULATION_VERSION,
  type Baseline,
  type Choices,
  type SimMatch,
  type SimStage,
} from "./types";

export function simulateMajor(base: Baseline, choices: Choices): SimStage[] {
  if (base.version !== SIMULATION_VERSION)
    throw new Error("该推演使用旧版规则，只能查看保存结果");
  const first = base.stages[0];
  if (!first || base.teams.length !== 32) return [];
  const opening = buildMajorOpeningPlan({
    teams: base.teams,
    stageOneMatchFormat: first.matchFormat,
  });
  const result: SimStage[] = [];
  let qualifiers: { teamId: string; finalStageSeed: number }[] = [];
  let hypothetical = false;
  for (const [index, stage] of base.stages.entries()) {
    const run = base.runs.find((r) => r.key === stage.key);
    let entrants: { teamId: string; seed: number }[];
    if (run && !hypothetical) entrants = run.entrants;
    else if (index === 0)
      entrants = opening.stage1.entrants.map((e) => ({
        teamId: e.teamId,
        seed: e.initialStageSeed,
      }));
    else if (qualifiers.length !== 8) break;
    else if (stage.type === "single_elim")
      entrants = qualifiers.map((e) => ({
        teamId: e.teamId,
        seed: e.finalStageSeed,
      }));
    else {
      const [lo, hi] = directSeedRange(base.stages, index, stage.entrySeeds);
      entrants = seedMajorLaterStageEntrants({
        directEntrants: base.teams.filter(
          (e) => e.tournamentSeed >= lo && e.tournamentSeed <= hi,
        ),
        advancingEntrants: qualifiers.map((e) => ({
          teamId: e.teamId,
          previousStageFinalSeed: e.finalStageSeed,
        })),
      }).map((e) => ({ teamId: e.teamId, seed: e.initialStageSeed }));
    }
    const officialEntrants = !!run && !hypothetical;
    const rows: SimMatch[] = [];
    const invalidated = new Set<string>();
    const stageOfficial = !hypothetical;
    let roundOfficial = !hypothetical;
    const select = (
      key: string,
      round: number,
      a: string,
      b: string,
      format: string,
    ): SimMatch => {
      const choice = choices[`${stage.key}/${key}`];
      const compatible =
        choice &&
        [choice.a, choice.b].includes(a) &&
        [choice.a, choice.b].includes(b) &&
        [a, b].includes(choice.winner);
      const official = (
        stage.type === "single_elim"
          ? stageOfficial && !invalidated.has(key)
          : roundOfficial
      )
        ? base.matches.find(
            (m) =>
              m.stageKey === stage.key &&
              m.key === key &&
              [m.a, m.b].includes(a) &&
              [m.a, m.b].includes(b),
          )
        : undefined;
      const winner = compatible ? choice.winner : (official?.winner ?? null);
      if (compatible && winner !== official?.winner) {
        hypothetical = true;
        if (stage.type === "single_elim")
          for (const child of playoffDescendants(key as PlayoffManagedKey))
            invalidated.add(child);
      }
      return {
        key,
        round,
        a,
        b,
        winner,
        format,
        source: compatible ? "assumption" : winner ? "official" : "pending",
      };
    };
    if (stage.type === "swiss") {
      const seeded: MajorSwissEntrant[] = entrants.map((e) => ({
        teamId: e.teamId,
        initialStageSeed: e.seed,
      }));
      const facts: MajorSwissMatchFact[] = [];
      let finalized: 0 | 1 | 2 | 3 | 4 | 5 = 0;
      for (let r = 1; r <= 5; r++) {
        roundOfficial = !hypothetical;
        const pairs = generateNextMajorSwissRound({
          entrants: seeded,
          matches: facts,
          finalizedRound: finalized,
          stageMatchFormat: stage.matchFormat,
        });
        const roundRows = pairs.map((p, i) =>
          select(
            `r${r}-${i + 1}`,
            r,
            p.higherSeedTeamId,
            p.lowerSeedTeamId,
            p.format,
          ),
        );
        rows.push(...roundRows);
        if (roundRows.some((m) => !m.winner)) break;
        facts.push(
          ...roundRows.map((m) => ({
            matchId: m.key,
            round: r as 1 | 2 | 3 | 4 | 5,
            entryAId: m.a,
            entryBId: m.b,
            winnerId: m.winner!,
          })),
        );
        finalized = r as 1 | 2 | 3 | 4 | 5;
      }
      const projection = projectMajorSwissStage({
        entrants: seeded,
        matches: facts,
        finalizedRound: finalized,
      });
      qualifiers =
        finalized === 5 ? [...getMajorSwissQualifiers(projection)] : [];
      result.push({
        key: stage.key,
        entrants,
        officialEntrants,
        matches: rows,
        complete: finalized === 5,
        standings: projection.teams.map((t) => ({
          teamId: t.teamId,
          wins: t.wins,
          losses: t.losses,
        })),
        pick:
          finalized === 5
            ? {
                perfect: projection.teams
                  .filter((t) => t.wins === 3 && t.losses === 0)
                  .map((t) => t.teamId),
                advance: projection.teams
                  .filter((t) => t.wins === 3 && t.losses > 0)
                  .map((t) => t.teamId),
                eliminated: projection.teams
                  .filter((t) => t.losses === 3 && t.wins === 0)
                  .map((t) => t.teamId),
              }
            : null,
      });
    } else {
      const facts: MajorPlayoffMatchFact[] = [];
      const seeded = entrants.map((e) => ({
        teamId: e.teamId,
        playoffSeed: e.seed,
      }));
      for (let r = 1; r <= 3; r++) {
        roundOfficial = !hypothetical;
        const pairs = generateMajorPlayoffNextRound({
          entrants: seeded,
          matches: facts,
        });
        const roundRows = pairs.map((p) =>
          select(
            `${p.round === "quarterfinal" ? "qf" : p.round === "semifinal" ? "sf" : "final"}-${p.slot}`,
            r,
            p.higherSeedTeamId,
            p.lowerSeedTeamId,
            p.round === "final" ? "bo5" : "bo3",
          ),
        );
        rows.push(...roundRows);
        if (roundRows.some((m) => !m.winner)) break;
        facts.push(
          ...roundRows.map((m, i) => ({
            matchId: m.key,
            round: pairs[i]!.round,
            slot: pairs[i]!.slot,
            entryAId: m.a,
            entryBId: m.b,
            winnerId: m.winner!,
          })),
        );
      }
      result.push({
        key: stage.key,
        entrants,
        officialEntrants,
        matches: rows,
        complete: facts.length === 7,
        standings: [],
        pick:
          facts.length === 7 ? { bracket: facts.map((m) => m.winnerId) } : null,
      });
    }
  }
  return result;
}
/** An upstream edit invalidates the whole later Swiss round/stages; caller previews this list before committing. */
export function replaceSimulationChoice(
  base: Baseline,
  choices: Choices,
  stageKey: string,
  match: SimMatch,
  winner: string,
): Choices {
  if (![match.a, match.b].includes(winner)) throw new Error("胜者不是对阵方");
  const projected = simulateMajor(base, choices);
  const index = base.stages.findIndex((s) => s.key === stageKey);
  const next: Choices = {};
  const descendants =
    base.stages[index]?.type === "single_elim"
      ? playoffDescendants(match.key as PlayoffManagedKey)
      : null;
  for (const [key, value] of Object.entries(choices)) {
    const [s, k] = key.split("/");
    const si = base.stages.findIndex((stage) => stage.key === s);
    const previous = projected
      .find((stage) => stage.key === s)
      ?.matches.find((m) => m.key === k);
    if (
      si < index ||
      (si === index &&
        previous &&
        (descendants
          ? !descendants.has(k as PlayoffManagedKey)
          : previous.round <= match.round) &&
        k !== match.key)
    )
      next[key] = value;
  }
  next[`${stageKey}/${match.key}`] = { a: match.a, b: match.b, winner };
  return next;
}
