/** Keep return destinations inside this event; never trust an arbitrary URL. */
export function resolveMatchReturnContext(seasonSlug: string, value: string | undefined, isTest: boolean) {
  const root = `/admin/${seasonSlug}`;
  const fallback = { href: `${root}/${isTest ? "test-matches" : "matches"}`, label: isTest ? "回到测试赛" : "回到比赛执行" };
  if (!value || !value.startsWith(`${root}`) || value.includes("\\")) return fallback;
  const url = new URL(value, "https://return.invalid");
  const allowed = new Map([
    [root, "回到赛事总览"], [`${root}/prestart`, "回到开赛筹备"],
    [`${root}/matches`, url.searchParams.get("view") === "schedule" ? "回到赛程与阶段" : "回到比赛执行"],
    [`${root}/test-matches`, "回到测试赛"], [`${root}/logs`, "回到操作记录"],
  ]);
  const label = allowed.get(url.pathname);
  return label && url.origin === "https://return.invalid" ? { href: `${url.pathname}${url.search}${url.hash}`, label } : fallback;
}
