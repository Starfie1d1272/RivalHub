import type { MatchFormat } from "@/types/match";

/** Shared BP terminology for public records and the interactive room. */
export const VETO_ACTION_LABELS = {
  role_select: "选择先禁图队伍",
  ban: "BAN",
  pick: "PICK",
  side_pick: "SIDE",
  decider: "DECIDER",
} as const;

export const VETO_ACTION_HELP = {
  role_select: "选择自己或对手成为先禁图方，决定整场 BP 的禁选与选边顺序。",
  ban: "禁用地图，将其移出本场可选地图池。",
  pick: "选择本场要进行的地图。",
  side_pick: "选择该图以 CT 或 T 开局。",
  decider: "双方禁选后留下的决胜图。",
} as const;

const ROLE_HELP: Record<MatchFormat, string> = {
  bo1: "BO1：先禁图方先禁 2 图，后禁图方再禁 3 图，先禁图方最后禁 1 图；后禁图方选择剩余图的起始边。",
  bo3: "BO3：先禁图方先选 Map 1，并执行最后一次 BAN；后禁图方选 Map 2 和 Map 3 起始边。双方选图均由对手选边。",
  bo5: "BO5：双方各禁 1 图后，先禁图方选 Map 1、3，后禁图方选 Map 2、4，均由对手选边；Map 5 由刀赛决定起始边。",
};

export function vetoActionHelp(action: keyof typeof VETO_ACTION_HELP, format: MatchFormat): string {
  return action === "role_select" ? `${VETO_ACTION_HELP.role_select}${ROLE_HELP[format]}` : VETO_ACTION_HELP[action];
}

/** Captain operation labels; historical record labels remain stable. */
export const VETO_PHASE_LABELS = {
  role_select: "选择先禁图队伍",
  ban: "禁用地图",
  pick: "选取地图",
  side_pick: "选择起始方",
  decider: "确定决胜图",
} as const;
