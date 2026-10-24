import { completedVetoMaps } from "@/lib/matches/veto-result";
import { sameIds, subjectMatches, resolveBetFact, type MarketFactInput } from "@/lib/bet/domain";
import { isActiveCompetitionQualificationRun } from "@/lib/competition-qualification/activity";
import type { FreePredictionKind, FreePredictionSubject, FreePredictionResultDTO, FreePredictionRestrictionDTO } from "./types";
export function freePredictionCompetitionIsOpen(
  season: { id: string; status: string },
  match: { majorStageRunId: string | null; qualificationRunId: string | null },
  qualificationRun?: Parameters<typeof isActiveCompetitionQualificationRun>[2],
): boolean {
  if (match.qualificationRunId) return isActiveCompetitionQualificationRun(season, match.qualificationRunId, qualificationRun);
  return !!match.majorStageRunId && ["playing", "drafting"].includes(season.status);
}
export function predictionInput(subject: FreePredictionSubject, input: Omit<MarketFactInput, "type" | "subject" | "line" | "voidedAt">): MarketFactInput {
  return { ...input, type: "match_winner", subject: { ...subject, kind: "match" }, line: null, voidedAt: null };
}
export function gradePrediction(kind: FreePredictionKind, selection: string[], input: MarketFactInput): FreePredictionResultDTO {
  const total = kind === "result" ? 1 : Number(input.match?.format.slice(2) ?? (input.subject.kind === "event" ? "1" : input.subject.format.slice(2)));
  const pending: FreePredictionResultDTO = { state: "pending", hits: null, total, answer: null };
  const voided: FreePredictionResultDTO = { ...pending, state: "void" };
  if (!subjectMatches(input.subject, input.match, input.maps, input.veto) || input.match?.isForfeit || input.match?.status === "cancelled") return voided;
  if (kind === "result") {
    const fact = resolveBetFact(input);
    if (fact.state === "void") return voided;
    if (fact.state !== "confirmed") return pending;
    const hits = fact.winningKeys.includes(selection[0]!) ? 1 : 0;
    return { state: hits ? "correct" : "incorrect", hits, total: 1, answer: [...fact.winningKeys] };
  }
  const answer = input.match ? completedVetoMaps(input.match.format, input.match.entryAId, input.veto) : null;
  if (!answer) return pending;
  const hits = selection.filter(name => answer.includes(name)).length;
  return { state: sameIds(selection, answer) ? "correct" : "incorrect", hits, total, answer };
}

/** Presentation reasons derive from canonical facts; write authorization remains in the service. */
export function freePredictionRestriction(input: {
  status: "scheduled" | "in_progress" | "finished" | "cancelled"; isForfeit: boolean;
  competitionOpen: boolean; signedIn: boolean; active: boolean; verified: boolean; locked: boolean; validMapPool: boolean;
}): FreePredictionRestrictionDTO | null {
  if(input.status === "cancelled") return {code:"cancelled",message:"比赛已取消"};
  if(input.isForfeit) return {code:"forfeit",message:"弃权比赛不计预测成绩"};
  if(input.status === "finished") return {code:"finished",message:"比赛已结束"};
  if(!input.competitionOpen) return {code:"season_closed",message:"赛事当前不可预测"};
  if(input.locked) return {code:"started",message:"预测已截止"};
  if(!input.signedIn) return {code:"sign_in",message:"登录后免费预测"};
  if(!input.active) return {code:"account_inactive",message:"账号当前不可使用"};
  if(!input.verified) return {code:"verify_email",message:"请先完成邮箱验证"};
  if(!input.validMapPool) return {code:"invalid_map_pool",message:"官方地图池暂不可用"};
  return null;
}
