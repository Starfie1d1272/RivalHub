import type { OfficialVetoResult } from "./veto-result";
export interface MatchFact {
  id: string;
  entryAId: string;
  entryBId: string;
  majorStageRunId: string | null;
  qualificationRunId: string | null;
  format: "bo1" | "bo3" | "bo5";
  status: "scheduled" | "in_progress" | "finished" | "cancelled";
  isForfeit: boolean;
  startedAt: Date | null;
  scoreA: number | null;
  scoreB: number | null;
}
export interface MapFact {
  id: string;
  matchId: string;
  mapOrder: number;
  mapName: string;
  startedAt: Date | null;
  completedAt: Date | null;
  scoreA: number | null;
  scoreB: number | null;
}
export interface VetoFact extends OfficialVetoResult {
  startedAt: Date | null;
}
export function sameIds(a: readonly string[], b: readonly string[]) {
  return [...a].sort().join(",") === [...b].sort().join(",");
}
export interface MatchSubject {
  entryIds: string[];
  runId: string;
  format: MatchFact["format"];
  mapPool?: string[];
}
export function matchSubjectMatches(
  subject: MatchSubject,
  match:
    | Pick<MatchFact, "entryAId" | "entryBId" | "majorStageRunId" | "qualificationRunId" | "format">
    | undefined,
  veto?: Pick<VetoFact, "mapPoolSnapshot">,
): boolean {
  return (
    !!match &&
    subject.entryIds[0] === match.entryAId &&
    subject.entryIds[1] === match.entryBId &&
    subject.runId === (match.majorStageRunId ?? match.qualificationRunId) &&
    subject.format === match.format &&
    !(
      subject.mapPool?.length &&
      veto?.mapPoolSnapshot &&
      !sameIds(subject.mapPool, veto.mapPoolSnapshot)
    )
  );
}
export function matchPredictionLocked(
  subject: MatchSubject,
  match: MatchFact | undefined,
  veto: VetoFact | undefined,
  bp: boolean,
): boolean {
  return (
    !matchSubjectMatches(subject, match, veto) ||
    !match ||
    match.isForfeit ||
    ["finished", "cancelled"].includes(match.status) ||
    !!match.startedAt ||
    (bp && !!veto?.startedAt)
  );
}
export function matchWinner(match: MatchFact): string | null {
  return match.status === "finished" &&
    match.scoreA !== null &&
    match.scoreB !== null &&
    match.scoreA !== match.scoreB
    ? match.scoreA > match.scoreB
      ? match.entryAId
      : match.entryBId
    : null;
}
