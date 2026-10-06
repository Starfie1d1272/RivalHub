import type { MarketType, BetState } from "./types";
const catalog: Record<MarketType, { title: string; group: "赛事" | "比赛" | "BP" | "单图"; help: string }> = {
  champion: { title: "冠军", group: "赛事", help: "正赛冠军正式确认后结算；正赛第一场 BP 或比赛开始时锁盘。" },
  top_fragger: { title: "赛事击杀王", group: "赛事", help: "按正赛所有正式地图的已确认 Demo 总击杀计算；包含加时，并列第一共同获胜。全部地图统计确认后结算。" },
  match_winner: { title: "比赛胜者", group: "比赛", help: "实际开赛时锁盘，正式比赛结束后结算；弃权、取消或对阵更正退款。" },
  exact_score: { title: "精确比分", group: "比赛", help: "比分按页面左侧队伍 : 右侧队伍排列；实际开赛时锁盘。" },
  total_maps: { title: "总地图数", group: "比赛", help: "大：实际进行的地图数高于分界线；小：低于分界线。实际开赛时锁盘；弃权退款。" },
  veto_map: { title: "BP · 本场地图", group: "BP", help: "BP 开始时锁盘；完整 BP 确认且没有待处理申诉后结算。" },
  veto_first: { title: "BP · 首图", group: "BP", help: "预测第一张比赛地图；BP 开始时锁盘，完整 BP 无待处理申诉时结算。" },
  veto_decider: { title: "BP · 决胜图", group: "BP", help: "预测 BP 留下的最后一张地图，无论最终是否进行；BP 开始时锁盘。" },
  map_winner: { title: "单图胜者", group: "单图", help: "上一图结束后开放，本图实际开始时锁盘；正式单图结果确认后结算。" },
  total_rounds: { title: "总回合", group: "单图", help: "包含加时。大：双方最终回合数之和高于分界线；小：低于分界线。分界线开盘时固定。" },
};
export function marketPresentation(type: MarketType, lineTwice: number | null) {
  const row = catalog[type];
  return { ...row, title: `${row.title}${lineTwice === null ? "" : ` · ${lineTwice / 2}`}` };
}
export const betStateLabel: Record<BetState,string> = { open:"开放",locked:"已锁盘",settled:"已结算",refunded:"已退款" };
export function formatPoints(value: string): string { return BigInt(value).toLocaleString("zh-CN"); }
