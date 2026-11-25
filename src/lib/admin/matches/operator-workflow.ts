import type { MatchStatus, Side } from "@/types/match";
import {
  projectMatchPresentationPhase,
  type MatchPresentationPhase,
} from "@/lib/matches/presentation-phase";
import {
  projectOperatorSource,
  type OperatorSourceFacts,
  type AdminPrimaryTask,
  type SourceMode,
  type SourceHealth,
  type ReviewReason,
} from "./source-state";
import { mapLabel } from "@/lib/maps";
import {
  projectPostMatchCompletion,
  POST_MATCH_COMPLETION_LABEL,
} from "@/lib/postmatch/completion";

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
  demoReviewAnchor?: string;
}

export type PerfectRoomFieldTone = "default" | "active" | "warn";

export interface PerfectRoomGuideField {
  label: string;
  value: string | null;
  copyable?: boolean;
  badge?: string;
  note?: string;
  tone?: PerfectRoomFieldTone;
}

export interface PerfectRoomGuideFields {
  season: PerfectRoomGuideField;
  round: PerfectRoomGuideField;
  description: PerfectRoomGuideField;
  gameMode: PerfectRoomGuideField;
  team1: PerfectRoomGuideField;
  coach1: PerfectRoomGuideField;
  team2: PerfectRoomGuideField;
  coach2: PerfectRoomGuideField;
  mapMode: PerfectRoomGuideField;
  server: PerfectRoomGuideField;
  observer: PerfectRoomGuideField;
  gotv1: PerfectRoomGuideField;
  gotv2: PerfectRoomGuideField;
  gotvPassword: PerfectRoomGuideField;
  side: PerfectRoomGuideField;
  testMatch: PerfectRoomGuideField;
}

export interface PerfectRoomGuideData {
  mapOrder: number;
  mapName: string;
  fields: PerfectRoomGuideFields;
}

const PERFECT_MAP_OPTION_LABELS: Record<string, string> = {
  de_mirage: "荒漠迷城 de_mirage",
  de_inferno: "炼狱小镇 de_inferno",
  de_nuke: "核子危机 de_nuke",
  de_ancient: "远古遗迹 de_ancient",
  de_dust2: "炙热沙城II de_dust2",
  de_anubis: "阿努比斯 de_anubis",
  de_train: "列车停放站 de_train",
  de_cache: "死城之谜 de_cache",
  de_overpass: "死亡游乐园 de_overpass",
  de_vertigo: "殒命大厦 de_vertigo",
};

function perfectMapOptionLabel(mapKey: string): string {
  return PERFECT_MAP_OPTION_LABELS[mapKey] ?? mapLabel(mapKey);
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
  const sideConfirmed = input.map.startSide === "ct" || input.map.startSide === "t";
  return {
    mapOrder: input.map.order,
    mapName: mapLabel(input.map.name),
    fields: {
      season: { label: "比赛归属", value: input.seasonName, tone: "active" },
      round: { label: "轮次", value: input.roundLabel, copyable: true, tone: "active" },
      description: {
        label: "比赛短描述",
        value: input.description,
        copyable: true,
        tone: "active",
      },
      gameMode: { label: "游戏模式", value: "普通模式", badge: "保持默认", tone: "default" },
      team1: { label: "设置队伍 1", value: input.teamAName, copyable: true, tone: "active" },
      coach1: { label: "教练 64 位 ID", value: "留空（非必填）", tone: "default" },
      team2: { label: "设置队伍 2", value: input.teamBName, copyable: true, tone: "active" },
      coach2: { label: "教练 64 位 ID", value: "留空（非必填）", tone: "default" },
      mapMode: {
        label: "选图模式",
        value: perfectMapOptionLabel(input.map.name),
        badge: "须手动改选",
        note: "直接选单图，勿选「队长BP选图」",
        tone: "warn",
      },
      server: {
        label: "服务器选择",
        value: "上海大区",
        badge: "须手动改选",
        note: "后台默认「队长BP服务器」，须手动改选",
        tone: "warn",
      },
      observer: { label: "观察者选项", value: "任意观察者", badge: "保持默认", tone: "default" },
      gotv1: { label: "GOTV 线路 1 延迟", value: "留空（默认 0s）", tone: "default" },
      gotv2: {
        label: "GOTV 线路 2 延迟",
        value: "120",
        copyable: true,
        note: "默认 30s → 填 120",
        tone: "active",
      },
      gotvPassword: { label: "GOTV Password", value: "1", copyable: true, tone: "active" },
      side: {
        label: "选边方式",
        value:
          input.map.startSide === "ct"
            ? "TEAM 1 CT / TEAM 2 T"
            : input.map.startSide === "t"
              ? "TEAM 1 T / TEAM 2 CT"
              : "起始边尚未确定，请先核对 BP 选边",
        badge: "须核对",
        note: sideConfirmed ? "勿保留默认「使用BP结果」" : "BP 选边未完成前请勿建房",
        tone: "warn",
      },
      testMatch: { label: "测试赛", value: "保持关闭", tone: "default" },
    },
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
  const completedMaps = maps.filter((map) => map.completedAt !== null);
  const missingHistory = maps.find(
    (map) =>
      map.completedAt === null && completedMaps.some((completed) => completed.order > map.order),
  );
  const outstanding = completedMaps.filter((map) => !map.scoreboardComplete);
  const source = projectOperatorSource(input.source ?? null);
  const phase = projectMatchPresentationPhase({
    status: input.status,
    scheduledAt: input.scheduledAt ?? null,
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    veto: input.vetoComplete
      ? "completed"
      : input.status === "in_progress"
        ? "in_progress"
        : "not_started",
    maps,
    gameplayMapId: input.observedGameplayMapId,
  });
  const manualResultAllowed =
    (Boolean(missingHistory) && phase !== "gameplay") ||
    source.sourceMode === "none" ||
    (source.sourceMode === "manual_map" &&
      input.source?.currentMapId === maps.find((map) => map.completedAt === null)?.id);
  const completedPrevious = completedMaps.at(-1);
  const elapsed =
    phase === "inter_map" &&
    maps.some((map) => map.completedAt === null) &&
    completedPrevious?.completedAt
      ? { since: completedPrevious.completedAt, label: `距 Map ${completedPrevious.order} 结束` }
      : null;
  const base = {
    ...source,
    phase,
    primaryTask: "prepare" as AdminPrimaryTask,
    manualResultAllowed,
    focusMapId: null,
    roomMapId: null,
    elapsed,
    completedMaps,
    isPostMatch: input.status === "finished",
  };
  if (input.status === "cancelled")
    return {
      ...base,
      title: "本场已取消",
      description: "可在比赛总览查看其它场次。",
      nextStep: "回到比赛总览查看其它场次。",
    };
  const nextMap = maps.find((map) => map.completedAt === null);
  const gameplayMap = maps.find(
    (map) => map.id === input.observedGameplayMapId && map.completedAt === null,
  );
  const gameplayTitle =
    phase === "gameplay" && gameplayMap
      ? `Map ${gameplayMap.order} · ${mapLabel(gameplayMap.name)} 进行中`
      : null;
  if (missingHistory && phase !== "gameplay" && input.status === "in_progress")
    return {
      ...base,
      primaryTask: "manual_result",
      title: `补录 Map ${missingHistory.order} 比分`,
      description: "后续地图已记录正式结果，请补录此前缺失的比分。",
      nextStep: "核对并录入此前地图的正式比分。",
    };
  if (source.reviewReasons.length) {
    const prepareNext = input.vetoComplete && phase === "inter_map" && nextMap;
    return {
      ...base,
      primaryTask: "review",
      title:
        gameplayTitle ??
        (prepareNext
          ? `Map ${completedPrevious!.order} 已记录 · 准备 Map ${nextMap.order}`
          : input.status === "finished"
            ? "赛果已记录 · 核对采集差异"
            : manualResultAllowed
              ? "本图手动录分 · 采集问题待处理"
              : "比赛数据需要核对"),
      description: "请根据下方差异检查比赛与采集来源。",
      nextStep: prepareNext
        ? "按正式地图计划准备下一图房间，上一图计分板可同时补充。"
        : input.status === "finished"
          ? "继续整理赛后资料，并核对采集差异。"
          : manualResultAllowed
            ? "核对当前地图，在本图结束后提交比分。"
            : "核对采集状态，或登记问题并手动录分。",
      roomMapId: prepareNext ? nextMap.id : null,
      focusMapId: prepareNext ? (outstanding[0]?.id ?? null) : null,
    };
  }

  if (input.status === "finished") {
    if (input.isForfeit && completedMaps.length === 0)
      return {
        ...base,
        isPostMatch: true,
        primaryTask: "post",
        title: "本场已判负 / 弃权",
        description: "弃赛结果已记录。",
        nextStep: "核对赛后资料，再查看你的下一场。",
      };
    return {
      ...base,
      isPostMatch: true,
      primaryTask: "post",
      title: outstanding.length ? `补齐 Map ${outstanding[0].order} 平台计分板` : "整理赛后资料",
      description: "系列赛赛果已确认；逐图检查计分板和 Demo，另行确认解说名单与比赛录像。",
      nextStep: completedMaps.length
        ? "去 Perfect 下载已完成地图的 Demo，用 RivalHub Demo Uploader 上传，再检查同步结果与赛后资料。"
        : "核对已完成比赛的地图记录与赛后资料。",
      focusMapId: outstanding[0]?.id ?? null,
    };
  }
  if (!input.vetoComplete)
    return {
      ...base,
      title: input.status === "scheduled" ? "核对首发并进入 BP" : "完成 BP 地图计划",
      description: "双方完成地图禁选与选边后，按结果创建 Perfect 房间。",
      nextStep: "BP 完成后，查看 Map 1 的 Perfect 建房指引。",
    };
  if (!nextMap)
    return {
      ...base,
      title: "核对本场赛果",
      description: "当前没有待进行地图，请核对正式系列赛结果。",
      nextStep: "需要更正时使用下方结果与恢复操作。",
    };
  if (input.source && source.sourceMode === "mizar_auto" && source.sourceHealth !== "healthy")
    return {
      ...base,
      primaryTask: "source_check",
      title:
        gameplayTitle ??
        (source.sourceHealth === "stale" ? "比赛数据暂未更新" : "等待 Mizar 核验本场数据"),
      description: "请检查 Mizar 与游戏采集状态。",
      nextStep: "收到本场有效数据后，系统会更新核验状态。",
      roomMapId: phase === "gameplay" ? null : nextMap.id,
    };
  if (gameplayTitle && source.sourceMode === "mizar_auto")
    return {
      ...base,
      primaryTask: "observe",
      title: gameplayTitle,
      description: "本图采用 Mizar 自动赛果。",
      nextStep: "",
    };
  if (phase === "gameplay" && manualResultAllowed)
    return {
      ...base,
      primaryTask: "manual_result",
      title: `人工记录 Map ${nextMap.order} 结果`,
      description: "本图已开始，继续比赛并在结束后记录正式比分。",
      nextStep: "核对本图比分；上一图平台计分板可赛后补齐。",
    };
  if (gameplayTitle)
    return {
      ...base,
      primaryTask: "source_check",
      title: gameplayTitle,
      description: "本图已开局，可在下方登记采集问题并手动录分。",
      nextStep: "核对本图与最终比分，再提交结果。",
    };
  const previous = completedMaps.at(-1);
  const previousNeedsScoreboard = previous && !previous.scoreboardComplete;
  return {
    ...base,
    primaryTask: manualResultAllowed ? "manual_result" : "prepare",
    title: `准备 Map ${nextMap.order} · ${mapLabel(nextMap.name)} 房间`,
    description: previousNeedsScoreboard
      ? "按下方指引创建下一图房间；上一图计分板可同时补充。"
      : "按建房指引核对 Perfect 房间，提醒双方进入；本图结束后记录正式比分。",
    nextStep: `准备 Map ${nextMap.order} 房间，提醒双方进入；平台计分板可稍后补齐。`,
    focusMapId: previousNeedsScoreboard ? previous.id : null,
    roomMapId: nextMap.id,
  };
}

export function formatOperatorElapsed(since: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return `+${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

/** Official result, map data and applicable production records have separate owners. */
export function projectOperatorCompletion(input: {
  status: MatchStatus;
  isForfeit: boolean;
  maps: readonly OperatorMap[];
  commentatorCount: number;
  submitted: boolean;
  hasVideo: boolean;
  reopened?: boolean;
}) {
  const played = input.maps.filter((map) => map.completedAt !== null);
  return {
    official: input.status === "finished" ? "已完赛" : "未完赛",
    data:
      (played.length > 0 || input.isForfeit) &&
      played.every((map) => map.scoreboardComplete && map.demoComplete)
        ? "已齐备"
        : "待补齐 OCR / Demo",
    production:
      input.commentatorCount === 0
        ? "暂无解说认领"
        : POST_MATCH_COMPLETION_LABEL[projectPostMatchCompletion(input)],
  };
}

/** Task destinations adapt the same completion facts used by the single-match workbench. */
export function projectOperatorPostMatchTasks(
  input: Parameters<typeof projectOperatorCompletion>[0],
) {
  if (input.status !== "finished") return [];
  const completion = projectOperatorCompletion(input);
  const tasks: { label: string; anchor: string }[] = [];
  if (completion.data !== "已齐备") {
    for (const map of input.maps
      .filter((map) => map.completedAt !== null)
      .sort((a, b) => a.order - b.order)) {
      if (!map.scoreboardComplete)
        tasks.push({ label: `Map ${map.order} · 补齐计分板`, anchor: `scoreboard-${map.id}` });
      if (!map.demoComplete)
        tasks.push({
          label: `Map ${map.order} · Demo ${map.demoLabel}`,
          anchor: map.demoReviewAnchor ?? `scoreboard-${map.id}`,
        });
    }
    if (!input.maps.some((map) => map.completedAt !== null))
      tasks.push({ label: "核对已完成比赛的地图记录", anchor: "match-workbench-finished-maps" });
  }
  if (input.commentatorCount > 0) {
    if (input.reopened && !input.submitted)
      tasks.push({ label: "确认更正后的解说名单", anchor: "match-workbench-finished-postmatch" });
    if (!input.hasVideo)
      tasks.push({ label: "登记解说回放", anchor: "match-workbench-finished-postmatch" });
  }
  return tasks;
}
