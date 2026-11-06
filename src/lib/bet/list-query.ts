import { z } from "zod";
import { safeLocalRedirect } from "@/lib/auth/redirect";

const views = ["open", "mine", "settled", "event", "leaderboard", "records"] as const;
export function betListQuery(params: URLSearchParams) {
  const one = (key: string) => (params.getAll(key).length === 1 ? params.get(key) : null);
  const rawView = one("view");
  const view = views.find((value) => value === rawView) ?? "open";
  const defaultSort = view === "open" ? "scheduled_asc" : "scheduled_desc";
  const rawSort = one("matchSort");
  const sort = rawSort === "scheduled_asc" || rawSort === "scheduled_desc" ? rawSort : defaultSort;
  return { view, sort, unpredicted: one("unpredicted") === "1", match: one("match") };
}
export function betListHref(
  slug: string,
  query: ReturnType<typeof betListQuery>,
  match = query.match,
) {
  const params = new URLSearchParams();
  if (query.view !== "open") params.set("view", query.view);
  if (query.sort !== (query.view === "open" ? "scheduled_asc" : "scheduled_desc"))
    params.set("matchSort", query.sort);
  if (query.unpredicted && query.view === "open") params.set("unpredicted", "1");
  if (match) params.set("match", match);
  const suffix = params.toString();
  return `/${slug}/bet${suffix ? `?${suffix}` : ""}`;
}
export function safeBetReturn(raw: string | undefined, slug: string) {
  if (typeof raw !== "string" || !raw || safeLocalRedirect(raw, "") !== raw) return null;
  const url = new URL(raw, "http://rivalhub.local");
  if (
    url.pathname !== `/${slug}/bet` ||
    url.hash ||
    [...url.searchParams.keys()].some(
      (key) => !["view", "matchSort", "unpredicted", "match"].includes(key),
    )
  )
    return null;
  const query = betListQuery(url.searchParams);
  if (url.searchParams.has("match") && (!query.match || !z.guid().safeParse(query.match).success))
    return null;
  return betListHref(slug, query);
}
