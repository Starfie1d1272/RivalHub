/** Private operator projection. Never included in the public phase contract. */
export type SourceMode = "none" | "mizar_auto" | "manual_map";
export type SourceHealth = "not_applicable" | "healthy" | "unknown" | "stale" | "conflict";
export type ReviewReason = "identity_mismatch" | "lineup_mismatch" | "source_conflict" | "continuity_failure" | "result_conflict" | "execution_mismatch";
export type AdminPrimaryTask = "prepare" | "observe" | "manual_result" | "review" | "source_check" | "post";
export interface OperatorSourceFacts {
  currentMapId: string | null;
  mapEpoch: number;
  manualTakeoverMapEpoch: number | null;
  identityHealth: string;
  lineupHealth: string;
  continuityHealth: string;
  autoCanonicalizationArmed: boolean;
  /** Only explicit current-source evidence; never lastReliableEventAt age. */
  freshness?: "fresh" | "stale" | "unknown";
  resultConflict?: boolean;
  sourceConflict?: boolean;
}
export function projectOperatorSource(source: OperatorSourceFacts | null) {
  const sourceMode: SourceMode = !source ? "none" : source.manualTakeoverMapEpoch === source.mapEpoch ? "manual_map" : "mizar_auto";
  const reviewReasons: ReviewReason[] = [];
  if (source?.continuityHealth === "execution_conflict") reviewReasons.push("execution_mismatch");
  if (source?.identityHealth === "conflict") reviewReasons.push("identity_mismatch");
  if (source?.lineupHealth === "conflict") reviewReasons.push("lineup_mismatch");
  if (source?.sourceConflict || source?.continuityHealth === "source_conflict") reviewReasons.push("source_conflict");
  if (source?.resultConflict || source?.continuityHealth === "result_conflict") reviewReasons.push("result_conflict");
  if (source?.continuityHealth === "conflict" && !source.resultConflict) reviewReasons.push("continuity_failure");
  const sourceHealth: SourceHealth = !source ? "not_applicable" : reviewReasons.length ? "conflict"
    : (source.freshness === "stale" || source.continuityHealth === "stale") ? "stale"
    : source.autoCanonicalizationArmed && [source.identityHealth, source.lineupHealth, source.continuityHealth].every(health => health === "healthy") ? "healthy" : "unknown";
  return { sourceMode, sourceHealth, reviewReasons };
}
export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  execution_mismatch: "地图与当前对局不一致", identity_mismatch: "采集的比赛需要核对", lineup_mismatch: "采集玩家与首发有差异", source_conflict: "请确认发送数据的设备",
  continuity_failure: "采集来源已变化，请确认当前对局", result_conflict: "上报比分与正式比分有差异",
};

export const SOURCE_MODE_LABEL: Record<SourceMode, string> = { none: "人工赛务", mizar_auto: "Mizar 自动赛果", manual_map: "本图手动录分" };
export const SOURCE_HEALTH_LABEL: Record<SourceHealth, string> = { not_applicable: "正常人工流程", healthy: "自动赛果核验正常", unknown: "待核验", stale: "比赛数据暂未更新", conflict: "需要处理" };
