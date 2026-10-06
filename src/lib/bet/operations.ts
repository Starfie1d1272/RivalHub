import type { BetBoardDTO, BetMarketDTO, BetState } from "./types";

export const BET_GROUPS = ["赛事", "比赛", "BP", "单图"] as const;
export const BET_OPERATION_PAGE_SIZE = 10;
export interface BetOperationsQuery {
  q: string;
  state: BetState | "";
  category: BetMarketDTO["group"] | "";
  stage: string;
  page: number;
}
export function parseBetOperationsQuery(raw: Record<string, string | string[] | undefined>): BetOperationsQuery {
  const value = (key: string) => typeof raw[key] === "string" ? raw[key] as string : "";
  const state = value("state");
  const category = value("category");
  const page = Number(value("page"));
  return {
    q: value("q").trim().slice(0, 120),
    state: ["open", "locked", "settled", "refunded"].includes(state) ? state as BetState : "",
    category: BET_GROUPS.includes(category as BetMarketDTO["group"]) ? category as BetMarketDTO["group"] : "",
    stage: value("stage").slice(0, 100),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}
export function betOperationsList(data: BetBoardDTO, query: BetOperationsQuery) {
  const stages = [...new Set(data.matches.map(m => m.stage))].sort();
  const stage = stages.includes(query.stage) ? query.stage : "";
  const needle = query.q.toLocaleLowerCase();
  const groups = [...new Set(data.markets.map(m => m.matchId))].map(id => {
    const match = data.matches.find(m => m.id === id);
    const title = match ? `${match.a} vs ${match.b}` : "正赛赛事盘";
    const markets = data.markets.filter(m => m.matchId === id);
    return { id: id ?? "event", match, title, markets };
  }).map(group => ({
    ...group,
    markets: group.markets.filter(m =>
      (!query.state || m.state === query.state) &&
      (!query.category || m.group === query.category) &&
      (!stage || group.match?.stage === stage) &&
      (!needle || [group.title, group.match?.stage ?? "", m.title, m.context, ...m.options.map(o => o.label)].some(text => text.toLocaleLowerCase().includes(needle))),
    ),
  })).filter(g => g.markets.length > 0);
  // Current operations precede historical groups; ties remain stable across refreshes.
  groups.sort((a, b) => {
    const current = (g: typeof a) => g.markets.some(m => m.state === "open" || m.state === "locked") ? 0 : 1;
    return current(a) - current(b) || (a.match?.scheduledAt ?? "").localeCompare(b.match?.scheduledAt ?? "") || a.id.localeCompare(b.id);
  });
  const total = groups.length;
  const totalPages = Math.max(1, Math.ceil(total / BET_OPERATION_PAGE_SIZE));
  const page = Math.min(query.page, totalPages);
  return { groups: groups.slice((page - 1) * BET_OPERATION_PAGE_SIZE, page * BET_OPERATION_PAGE_SIZE), total, totalPages, page, stages, stage };
}
