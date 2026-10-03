import type { MatchStatus, Side } from "@/types/match";
import { projectMatchPresentationPhase, type MatchPresentationPhase } from "@/lib/matches/presentation-phase";
import { projectOperatorSource, REVIEW_REASON_LABEL, type OperatorSourceFacts, type AdminPrimaryTask, type SourceMode, type SourceHealth, type ReviewReason } from "./source-state";
import { mapLabel } from "@/lib/maps";

export interface OperatorMap {
  id: string;
  order: number;
  name: string;
  startSide: Side | null;
  completedAt: string | null;
  scoreboardComplete: boolean;
  demoLabel: string;
  demoNeedsAttention: boolean;
  demoComplete?: boolean;
}

export interface PerfectRoomGuideData {
  mapOrder: number;
  mapName: string;
  copyFields: { label: string; value: string | null }[];
  instructions: { label: string; value: string }[];
}

/** A/B stays Team 1/2 for the entire series, independent of the chosen side. */
export function buildPerfectRoomGuide(input: {
  seasonName: string;
  roundLabel: string | null;
  description: string | null;
  teamAName: string;
  teamBName: string;
  map: Pick<OperatorMap, "order" | "name" | "startSide">;
}): PerfectRoomGuideData {
  return {
    mapOrder: input.map.order,
    mapName: mapLabel(input.map.name),
    copyFields: [
      { label: "轮次", value: input.roundLabel },
      { label: "比赛短描述", value: input.description },
      { label: "队伍 1", value: input.teamAName },
      { label: "队伍 2", value: input.teamBName },
      { label: "GOTV 线路 2 延迟", value: "120" },
      { label: "GOTV Password", value: "1" },
    ],
    instructions: [
      { label: "比赛归属", value: `选择 ${input.seasonName}` },
      { label: "游戏模式", value: "普通模式" },
      { label: "选图模式", value: mapLabel(input.map.name) },
      { label: "服务器", value: "上海大区" },
      { label: "观察者", value: "任意观察者" },
      { label: "GOTV 线路 1 延迟", value: "留空（默认 0s）" },
      { label: "选边方式", value: input.map.startSide === "ct" ? "TEAM 1 CT / TEAM 2 T" : input.map.startSide === "t" ? "TEAM 1 T / TEAM 2 CT" : "起始边尚未确定，请先核对 BP 选边" },
      { label: "测试赛", value: "不要勾选" },
      { label: "教练 64 位 ID", value: "留空" },
    ],
  };
}

export interface OperatorWorkflow {
  phase: MatchPresentationPhase;
  primaryTask: AdminPrimaryTask;
  sourceMode: SourceMode;
  sourceHealth: SourceHealth;
  reviewReasons: ReviewReason[];
  manualResultAllowed: boolean;
  title: string;
  description: string;
  nextStep: string;
  focusMapId: string | null;
  roomMapId: string | null;
  elapsed: { since: string; label: string } | null;
  completedMaps: OperatorMap[];
  isPostMatch: boolean;
}

/** A read projection only. Never writes lifecycle, room status or task completion. */
export function projectOperatorWorkflow(input: {
  status: MatchStatus;
  isForfeit: boolean;
  vetoComplete: boolean;
  maps: readonly OperatorMap[];
  observedGameplayMapId: string | null;
  source?: OperatorSourceFacts | null;
  scheduledAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}): OperatorWorkflow {
  const maps = [...input.maps].sort((a, b) => a.order - b.order);
  const completedMaps = maps.filter(map => map.completedAt !== null);
  const outstanding = completedMaps.filter(map => !map.scoreboardComplete);
  const source = projectOperatorSource(input.source ?? null);
  const phase = projectMatchPresentationPhase({ status: input.status, scheduledAt: input.scheduledAt ?? null, startedAt: input.startedAt ?? null, completedAt: input.completedAt ?? null, veto: input.vetoComplete ? "completed" : input.status === "in_progress" ? "in_progress" : "not_started", maps, gameplayMapId: input.observedGameplayMapId });
  const manualResultAllowed = source.sourceMode === "none" || (source.sourceMode === "manual_map" && input.source?.currentMapId === maps.find(map => map.completedAt === null)?.id);
  const completedPrevious = completedMaps.at(-1);
  const elapsed = phase === "inter_map" && maps.some(map => map.completedAt === null) && completedPrevious?.completedAt ? { since: completedPrevious.completedAt, label: `距 Map ${completedPrevious.order} 结束` } : null;
  const base = { ...source, phase, primaryTask: "prepare" as AdminPrimaryTask, manualResultAllowed, focusMapId: null, roomMapId: null, elapsed, completedMaps, isPostMatch: input.status === "finished" };
  if (input.status === "cancelled") return { ...base, title: "本场已取消", description: "不再准备后续地图。", nextStep: "回到比赛总览查看其它场次。" };
  if (source.reviewReasons.length) return { ...base, primaryTask: "review", title: "自动赛果已暂停：请核对以下问题", description: source.reviewReasons.map(reason => REVIEW_REASON_LABEL[reason]).join("；"), nextStep: source.reviewReasons.includes("result_conflict") ? "正式比分未被覆盖。先核对其是否正确；若正式比分有误，按下方更正限制处理，暂勿继续录入后续比分。" : completedMaps.some(map => map.id === input.source?.currentMapId) ? "本图正式比分已保存，不要重复录分。核对下方上报差异；下一图通过健康检查后恢复自动记录。" : source.sourceMode === "manual_map" ? "本图使用手动比分。先确认当前地图绑定，再在本图结束后录分；下一图核验通过后恢复自动记录。" : "按下方步骤核对；无法恢复自动记录时，可改为手动录入本图比分。" };
  if (input.status === "finished") {
    if (input.isForfeit && completedMaps.length === 0) return { ...base, isPostMatch: true, primaryTask: "post", title: "本场已判负 / 弃权", description: "没有实际进行的地图，无需 OCR 或 Demo。", nextStep: "核对赛后资料，再查看你的下一场。" };
    return {
      ...base, isPostMatch: true, primaryTask: "post",
      title: outstanding.length ? `补齐 Map ${outstanding[0].order} 平台计分板` : "整理赛后资料",
      description: "系列赛赛果已确认；逐图检查计分板和 Demo，另行确认解说名单与比赛录像。",
      nextStep: completedMaps.length ? "去 Perfect 下载已完成地图的 Demo，用 RivalHub Demo Uploader 上传，再检查同步结果与赛后资料。" : "核对已完成比赛的地图记录与赛后资料。",
      focusMapId: outstanding[0]?.id ?? null,
    };
  }
  if (!input.vetoComplete) return {
    ...base,
    title: input.status === "scheduled" ? "核对首发并进入 BP" : "完成 BP 地图计划",
    description: "双方在 Veto Room 完成禁选与起始边选择后，再按本场地图计划建房。",
    nextStep: "BP 完成后，查看 Map 1 的 Perfect 建房指引。",
  };
  const nextMap = maps.find(map => map.completedAt === null);
  if (!nextMap) return { ...base, title: "核对本场赛果", description: "当前没有待进行地图，请核对正式系列赛结果。", nextStep: "需要更正时使用下方结果与恢复操作。" };
  if (input.source && source.sourceMode === "mizar_auto" && source.sourceHealth !== "healthy") return {
    ...base, primaryTask: "source_check", title: source.sourceHealth === "stale" ? "Mizar 暂未提供新鲜数据" : "等待数据源核验",
    description: "自动赛果尚未就绪，正式比赛与已确认赛果保持有效。",
    nextStep: "检查 Mizar 是否仍在接收本场游戏数据。若本图即将结束且自动记录无法恢复，可改为手动录分。",
    roomMapId: phase === "gameplay" ? null : nextMap.id,
  };
  if (input.observedGameplayMapId === nextMap.id && source.sourceMode === "mizar_auto") return {
    ...base, primaryTask: "observe", title: `Map ${nextMap.order} · ${mapLabel(nextMap.name)} 进行中`,
    description: "数据源核验正常，系统自动接收本图赛果。",
    nextStep: "无需重复人工录分；图后可补齐平台计分板与 Demo。",
  };
  if (phase === "gameplay" && manualResultAllowed) return {
    ...base, primaryTask: "manual_result", title: `人工记录 Map ${nextMap.order} 结果`,
    description: "本图已开始，继续比赛并在结束后记录正式比分。",
    nextStep: "核对本图比分；上一图平台计分板可赛后补齐。",
  };
  const previous = completedMaps.at(-1);
  const previousNeedsScoreboard = previous && !previous.scoreboardComplete;
  return {
    ...base,
    primaryTask: manualResultAllowed ? "manual_result" : "prepare",
    title: previousNeedsScoreboard ? `补齐 Map ${previous.order} 平台计分板` : `准备 Map ${nextMap.order} · ${mapLabel(nextMap.name)} 房间`,
    description: previousNeedsScoreboard ? "去 Perfect 查看本图数据并完成 OCR；来不及时可赛后补齐，下方建房指引始终可用。" : "按建房指引核对 Perfect 房间，提醒双方进入；本图结束后记录正式比分。",
    nextStep: `准备 Map ${nextMap.order} 房间，提醒双方进入；平台计分板可稍后补齐。`,
    focusMapId: previousNeedsScoreboard ? previous.id : null,
    roomMapId: nextMap.id,
  };
}

export function formatOperatorElapsed(since: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return `+${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

/** Official result, map data and applicable production records have separate owners. */
export function projectOperatorCompletion(input: {
  status: MatchStatus; isForfeit: boolean; maps: readonly OperatorMap[];
  commentatorCount: number; submitted: boolean; hasVideo: boolean;
}) {
  const played = input.maps.filter(map => map.completedAt !== null);
  return {
    official: input.status === "finished" ? "已完赛" : "未完赛",
    data: (played.length > 0 || input.isForfeit) && played.every(map => map.scoreboardComplete && map.demoComplete) ? "已齐备" : "待补齐 OCR / Demo",
    production: input.commentatorCount === 0 ? "未登记解说，无需提交名单或录像" : input.submitted && input.hasVideo ? "已完成" : "待确认解说名单 / 补充录像",
  };
}
