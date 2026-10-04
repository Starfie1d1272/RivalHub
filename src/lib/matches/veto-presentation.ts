/** Shared BP terminology for public records and the interactive room. */
export const VETO_ACTION_LABELS = {
  role_select: "选择先禁图队伍",
  ban: "BAN",
  pick: "PICK",
  side_pick: "SIDE",
  decider: "DECIDER",
} as const;

export const VETO_ACTION_HELP = {
  role_select: "选择自己或对手先禁图。",
  ban: "禁用地图，将其移出本场可选地图池。",
  pick: "选择本场要进行的地图。",
  side_pick: "选择该图以 CT 或 T 开局。",
  decider: "双方禁选后留下的决胜图。",
} as const;
