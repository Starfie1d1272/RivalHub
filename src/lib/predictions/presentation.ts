import type { SimMatch } from "./types";
export const SIMULATION_SOURCE_LABELS: Record<SimMatch["source"], string> = {
  official: "官方赛果",
  assumption: "我的选择",
  preview: "系统补全",
  pending: "待选择",
};
export const SWISS_PICK_GROUPS = [
  { key: "perfect", label: "恰好 3胜0负", record: "3–0" },
  { key: "advance", label: "3胜1负 / 3胜2负", record: "3–1 / 3–2" },
  { key: "eliminated", label: "恰好 0胜3负", record: "0–3" },
] as const;
