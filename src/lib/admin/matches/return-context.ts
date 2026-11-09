export const MATCH_WORKBENCH_TASK_ANCHORS = {
  lineups: "match-lineups",
  scheduling: "match-scheduling",
  commentary: "match-commentary",
} as const;

export type MatchWorkbenchTask = keyof typeof MATCH_WORKBENCH_TASK_ANCHORS;

export function parseMatchWorkbenchTask(value: unknown): MatchWorkbenchTask | undefined {
  if (value === "lineups" || value === "scheduling" || value === "commentary") return value;
}

export function matchWorkbenchContextQuery(returnTo?: string, task?: MatchWorkbenchTask) {
  const query = new URLSearchParams();
  if (returnTo) query.set("returnTo", returnTo);
  if (task) query.set("task", task);
  return query.size > 0 ? `?${query}` : "";
}

export function matchWorkbenchHref(
  seasonSlug: string,
  matchId: string,
  options: { returnTo?: string; task?: MatchWorkbenchTask } = {},
): string {
  const { returnTo, task } = options;
  const anchor = task ? MATCH_WORKBENCH_TASK_ANCHORS[task] : undefined;
  return `/admin/${seasonSlug}/matches/${matchId}${matchWorkbenchContextQuery(returnTo, task)}${anchor ? `#${anchor}` : ""}`;
}

export function matchLineupQueueHref(seasonSlug: string, page = 1): string {
  return `/admin/${seasonSlug}/matches?task=lineups${page > 1 ? `&page=${page}` : ""}`;
}

/** A single alert can open the exact workbench; a group stays scoped to the queue. */
export function matchLineupReviewHref(seasonSlug: string, onlyMatchId: string | null) {
  return onlyMatchId
    ? matchWorkbenchHref(seasonSlug, onlyMatchId, {
        returnTo: `/admin/${seasonSlug}#workspace-alerts`,
        task: "lineups",
      })
    : matchLineupQueueHref(seasonSlug);
}

/** Keep return destinations inside this event; never trust an arbitrary URL. */
export function resolveMatchReturnContext(seasonSlug: string, value: unknown, isTest: boolean) {
  const root = `/admin/${seasonSlug}`;
  const fallback = {
    href: `${root}/${isTest ? "test-matches" : "matches"}`,
    label: isTest ? "回到测试赛" : "回到比赛执行",
  };
  if (typeof value !== "string" || !value.startsWith(root) || value.includes("\\")) return fallback;
  const url = new URL(value, "https://return.invalid");
  const allowed = new Map([
    [root, "回到赛事总览"],
    [`${root}/prestart`, "回到开赛筹备"],
    [
      `${root}/matches`,
      url.searchParams.get("task") === "lineups"
        ? "回到待核对首发"
        : url.searchParams.get("view") === "schedule"
          ? "回到赛程与阶段"
          : url.searchParams.get("view") === "materials"
            ? "回到赛后资料"
            : "回到比赛执行",
    ],
    [`${root}/test-matches`, "回到测试赛"],
    [`${root}/bet`, "回到 BET 管理"],
    [`${root}/logs`, "回到操作记录"],
  ]);
  const label = allowed.get(url.pathname);
  return label && url.origin === "https://return.invalid"
    ? { href: `${url.pathname}${url.search}${url.hash}`, label }
    : fallback;
}
