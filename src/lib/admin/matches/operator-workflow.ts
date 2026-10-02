import type { MatchStatus, Side } from "@/types/match";
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

/** Data completeness, not an invented OCR submission or a DAK verification flag. */
export function isOperatorScoreboardComplete(
  starterUserIds: readonly string[],
  rows: readonly { userId: string | null; ratingPro: number | null; rws: number | null; we: number | null }[],
): boolean {
  const starters = new Set(starterUserIds);
  if (starters.size !== 10) return false;
  return [...starters].every(userId => rows.some(row => row.userId === userId && row.ratingPro !== null && row.rws !== null && row.we !== null));
}

export interface OperatorWorkflow {
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
}): OperatorWorkflow {
  const maps = [...input.maps].sort((a, b) => a.order - b.order);
  const completedMaps = maps.filter(map => map.completedAt !== null);
  const outstanding = completedMaps.filter(map => !map.scoreboardComplete);
  const base = { focusMapId: null, roomMapId: null, elapsed: null, completedMaps, isPostMatch: false };
  if (input.status === "cancelled") return { ...base, title: "本场已取消", description: "不再准备后续地图。", nextStep: "回到比赛总览查看其它场次。" };
  if (input.status === "finished") {
    if (input.isForfeit && completedMaps.length === 0) return { ...base, isPostMatch: true, title: "本场已判负 / 弃权", description: "没有实际进行的地图，无需 OCR 或 Demo。", nextStep: "核对赛后资料，再查看你的下一场。" };
    return {
      ...base, isPostMatch: true,
      title: outstanding.length ? `补齐 Map ${outstanding[0].order} 平台计分板` : "整理赛后资料",
      description: "系列赛已结束。可先完成赛后口播，再回到这里整理资料。",
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
  if (input.observedGameplayMapId === nextMap.id) return {
    ...base,
    title: `进行 Map ${nextMap.order} 解说`,
    description: `已收到 ${mapLabel(nextMap.name)} 的开始记录；请在 Mizar 检查现场与直播。`,
    nextStep: `本图结束后回到这里完成 Map ${nextMap.order} OCR，再查看下一步。`,
  };
  const previous = completedMaps.at(-1);
  const previousNeedsScoreboard = previous && !previous.scoreboardComplete;
  return {
    ...base,
    title: previousNeedsScoreboard ? `补齐 Map ${previous.order} 平台计分板` : `确认 Map ${nextMap.order} 建房与开播`,
    description: previousNeedsScoreboard ? "去 Perfect 查看本图数据并完成 OCR；来不及时可赛后补齐，下方建房指引始终可用。" : "按建房指引核对 Perfect 房间；如果本图已经开始，直接返回 Mizar 继续解说。",
    nextStep: `准备 Map ${nextMap.order} 房间，提醒双方进入，然后返回 Mizar 检查 CS2 / OBS / 直播并继续解说。`,
    focusMapId: previousNeedsScoreboard ? previous.id : null,
    roomMapId: nextMap.id,
    elapsed: previous?.completedAt ? { since: previous.completedAt, label: `距 Map ${previous.order} 结束` } : null,
  };
}

export function formatOperatorElapsed(since: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return `+${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
