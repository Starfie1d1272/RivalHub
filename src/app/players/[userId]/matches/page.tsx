import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { PageLayout } from "@/components/rivalhub";
import { PageHeader } from "@/components/rivalhub/PageHeader";
import { ListToolbar } from "@/components/rivalhub/ListToolbar";
import { PlayerMatchHistoryTable } from "@/components/players/PlayerMatches";
import { StatsReturnLink } from "@/components/stats/StatsNavigationContext";
import { db } from "@/db/client";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";
import { getPublicPlayerById } from "@/lib/data/public-players";
import { resolveCanonicalUserId } from "@/lib/identity/canonical";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { getPublicPlayerMatches, getPublicPlayerMatchFilters, PLAYER_MATCHES_PAGE_SIZE } from "@/lib/players/public-matches";
import { canonicalPlayerHref, parsePlayerMatchesQuery, playerMatchesHref } from "@/lib/players/matches-view-state";
import type { PlayerPerformanceSearch } from "@/lib/players/performance-view-state";
import { readOptionalPublicStats } from "@/lib/stats/availability";
import { safeStatsReturn } from "@/lib/stats/return-context";

interface Props {
  params: Promise<{ userId: string }>;
  searchParams: Promise<PlayerPerformanceSearch>;
}

export default function PlayerMatchesPage(props: Props) {
  return <Suspense fallback={<PageLayout variant="wide"><p role="status" className="py-8 text-sm text-[var(--color-fg-dim)]">正在加载比赛记录…</p></PageLayout>}>
    <PlayerMatchesContent {...props} />
  </Suspense>;
}

async function PlayerMatchesContent({ params, searchParams }: Props) {
  const [{ userId }, search] = await Promise.all([params, searchParams]);
  const canonicalId = await resolveCanonicalUserId(db, userId);
  if (!canonicalId) notFound();
  if (canonicalId !== userId) redirect(canonicalPlayerHref(canonicalId, search, true) as Route);
  const user = await getPublicPlayerById(userId);
  if (!user) notFound();
  const query = parsePlayerMatchesQuery(search);
  const fromStats = safeStatsReturn(typeof search.fromStats === "string" ? search.fromStats : null);
  const result = await readOptionalPublicStats("player_match_history", async () => {
    const [history, events] = await Promise.all([getPublicPlayerMatches(userId, query), getPublicPlayerMatchFilters(userId)]);
    return { ...history, events };
  });
  const reset = { ...query, event: "", map: "", page: 1, cursor: "", direction: "older" as const };
  return <PageLayout variant="wide" className="space-y-5">
    <StatsReturnLink href={fromStats} />
    <Link href={canonicalPlayerHref(userId, search) as Route} className="inline-flex text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-accent)]">← 返回选手主页</Link>
    <PageHeader title={`${getPublicDisplayName(user)} · 比赛记录`} description="按系列赛分组的已确认个人逐图记录。队伍归属以当场阵容为准。" />
    {result === null ? <p role="alert" className="py-8 text-sm text-[var(--color-fg-mid)]">比赛记录暂时读取失败，请稍后刷新重试。</p> : <>
      <form action={`/players/${userId}/matches`}>
        {fromStats && <input type="hidden" name="fromStats" value={fromStats} />}
        <ListToolbar>
          <label className="flex min-w-0 flex-col gap-1.5 text-xs text-[var(--color-fg-mid)]">赛事
            <select name="event" defaultValue={query.event} key={`event-${query.event}`} className="min-h-9 max-w-64 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 text-sm text-[var(--color-fg)]">
              <option value="">全部公开赛事</option>
              {query.event && !result.events.some((event) => event.slug === query.event) && <option value={query.event}>所选赛事无出场记录</option>}
              {result.events.map((event) => <option key={event.id} value={event.slug}>{event.name}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1.5 text-xs text-[var(--color-fg-mid)]">地图
            <select name="map" defaultValue={query.map} key={`map-${query.map}`} className="min-h-9 max-w-56 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 text-sm text-[var(--color-fg)]">
              <option value="">全部地图</option>
              {query.map && !CS2_MAP_CATALOG.some((map) => map.key === query.map) && <option value={query.map}>{query.map}</option>}
              {CS2_MAP_CATALOG.map((map) => <option key={map.key} value={map.key}>{map.label}</option>)}
            </select>
          </label>
          <button type="submit" className="min-h-9 rounded-sm bg-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-bg)]">筛选</button>
          {(query.event || query.map) && <Link href={playerMatchesHref(userId, reset, fromStats) as Route} className="px-2 py-2 text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-accent)]">清除筛选</Link>}
        </ListToolbar>
      </form>
      {Number(search.page) > 1 && !query.cursor && <p role="status" className="text-xs text-[var(--color-fg-mid)]">链接缺少有效的分页定位，已从最新比赛开始。</p>}
      <p className="text-xs tabular-nums text-[var(--color-fg-dim)]">第 {query.page} 页 · 本页 {result.matches.length} 场系列赛 · 每页最多 {PLAYER_MATCHES_PAGE_SIZE} 场系列赛{query.map ? " · 仅展示命中的已确认个人地图" : ""}</p>
      {result.matches.length ? <PlayerMatchHistoryTable matches={result.matches} userId={userId} fromStats={fromStats} />
        : <div className="space-y-3 border-y border-[var(--color-border)] py-8 text-sm text-[var(--color-fg-dim)]">
          <p>{query.map ? "没有符合条件的已确认逐图记录。" : query.event || query.page > 1 || query.cursor ? "当前筛选或页码下没有比赛记录。" : "尚无公开的已完成比赛出场记录。"}</p>
          {(query.event || query.map || query.page > 1 || query.cursor) && <Link href={playerMatchesHref(userId, reset, fromStats) as Route} className="text-[var(--color-accent)] hover:underline">查看全部比赛</Link>}
        </div>}
      {result.matches.length > 0 && (result.hasNewer || result.hasOlder) && <nav aria-label="系列赛分页" className="flex items-center justify-center gap-4 text-sm">
        {result.hasNewer && <Link href={playerMatchesHref(userId, { ...query, page: Math.max(1, query.page - 1), cursor: result.matches[0].cursor, direction: "newer" }, fromStats) as Route} className="rounded-sm border border-[var(--color-border)] px-3 py-2 hover:text-[var(--color-accent)]">上一页</Link>}
        {result.hasOlder && <Link href={playerMatchesHref(userId, { ...query, page: query.page + 1, cursor: result.matches[result.matches.length - 1].cursor, direction: "older" }, fromStats) as Route} className="rounded-sm border border-[var(--color-border)] px-3 py-2 hover:text-[var(--color-accent)]">下一页</Link>}
      </nav>}
    </>}
  </PageLayout>;
}
