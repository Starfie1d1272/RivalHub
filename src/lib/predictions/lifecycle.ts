import { simulateMajor } from "./simulator";
import type { Baseline } from "./types";

/** Official results only: default winners and local choices never open Pick’Em. */
export function officialPickEmStages(base: Baseline) {
  const projected = simulateMajor(base, {});
  return base.stages.flatMap((stage) => {
    const previous = stage.previousKey
      ? base.runs.find((run) => run.key === stage.previousKey)
      : null;
    if (stage.previousKey && previous?.finalizedRound !== 5) return [];
    const projection = projected.find((candidate) => candidate.key === stage.key);
    if (!projection || projection.entrants.length !== (stage.type === "swiss" ? 16 : 8)) return [];
    return [{
      key: stage.key,
      kind: stage.type,
      stageRunId: base.runs.find((run) => run.key === stage.key)?.id ?? null,
      entrants: projection.entrants,
    }];
  });
}

/** No independent deadline. An elapsed deadline or an actual start is irreversible. */
export function pickEmWindowState(
  base: Baseline,
  contest: { stageKey: string; deadline: Date | null; lockedAt: Date | null },
  now: Date,
) {
  const matches = base.matches.filter((match) => match.stageKey === contest.stageKey);
  const scheduled = matches.flatMap((match) =>
    match.status !== "cancelled" && match.scheduledAt ? [new Date(match.scheduledAt).getTime()] : [],
  );
  const deadline = scheduled.length ? new Date(Math.min(...scheduled)) : null;
  const locked = !!contest.lockedAt ||
    (!!contest.deadline && contest.deadline <= now) ||
    (!!deadline && deadline <= now) ||
    matches.some((match) => match.status === "in_progress" || match.status === "finished");
  return { deadline: contest.lockedAt || (contest.deadline && contest.deadline <= now) ? contest.deadline : deadline, locked };
}

export function samePredictionEntrants(
  a: readonly { teamId: string; seed: number }[],
  b: readonly { teamId: string; seed: number }[],
) {
  return a.length === b.length && a.every((entry) =>
    b.some((other) => entry.teamId === other.teamId && entry.seed === other.seed),
  );
}
