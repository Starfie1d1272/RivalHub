"use client";
import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import type { Route } from "next";
import type { RecordSummary } from "@/lib/stats/records";
import { RECORD_EVENT_NAMES, type RecordEventKind } from "@/lib/stats/record-facts";
import type { RecordEventPage } from "@/lib/stats/tournament-query";
import { displayWeaponName } from "@/lib/stats/presentation";
import { CS2_MAP_CATALOG } from "@/lib/config/cs2-maps";
import { statsHref, navigateStatsScope, type StatsQuery } from "@/lib/stats/view-state";

const linkStyle = "transition-colors hover:text-[var(--color-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]";
const selectStyle = "min-h-10 max-w-full border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 py-2 text-sm";
const summaryKinds: RecordEventKind[] = ["ace", "fourKill", "zeus", "knife", "he", "fire", "teamKill"];
const groups = [
  { label: "个人表现", kinds: ["kills", "adr", "firstKills", "tradeKills"] },
  { label: "多杀纪录", kinds: ["fourKills", "aces", "fourKillsTotal", "acesTotal"] },
  { label: "残局与回合", kinds: ["clutch", "economy", "utilityDamage"] },
];
function mapLabel(name: string) { return CS2_MAP_CATALOG.find(map => map.key === name)?.label ?? "地图"; }
function Help({ label, children }: { label: string; children: React.ReactNode }) {
  return <span className="relative inline-block">{label}<HelpTooltip className="absolute left-full top-1/2 ml-1 -translate-y-1/2" label={`${label}说明`} content={children} /></span>;
}
function RecordRow({ record, query, seasonSlug }: { record: RecordSummary; query: StatsQuery; seasonSlug: string }) {
  const value = record.value === null ? "—" : record.kind === "clutch" ? `1v${record.value}` : record.kind === "adr" ? record.value.toFixed(1) : record.kind === "economy" ? `$${record.value.toLocaleString("en-US")}` : record.value;
  return <div className="min-w-0 py-3">
    <div className="flex items-baseline justify-between gap-3"><h4 className="text-sm text-[var(--color-fg-mid)]">{record.label}</h4><span className="shrink-0 text-xl font-semibold tabular-nums">{value}</span></div>
    {record.value !== null && <>
      <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-sm">
        {record.holders.slice(0, 2).map(holder => <Link key={holder.id} href={holder.href as Route} className={`${linkStyle} break-words font-medium`}>{holder.name}</Link>)}
        {record.holderCount > 2 && <span className="text-xs text-[var(--color-fg-dim)]">等 {record.holderCount} 人</span>}
      </div>
      <details className="mt-2">
        <summary className={`w-fit cursor-pointer py-1 text-xs text-[var(--color-fg-mid)] ${linkStyle}`}>来源 · {record.occurrenceCount} 项</summary>
        <ul className="mt-2 space-y-3 text-xs">{record.occurrences.map(o => <li key={`${o.mapId}:${o.round ?? 0}:${o.entityId}`} className="space-y-1 leading-5">
          <div className="flex flex-wrap gap-x-2"><Link href={o.entityHref as Route} className={`${linkStyle} font-medium`}>{o.entityName}</Link><Link href={`/${o.eventSlug}` as Route} className={linkStyle}>{o.eventName}</Link></div>
          <Link href={`/${o.eventSlug}/matches/${o.matchId}` as Route} className={`${linkStyle} block text-[var(--color-fg-mid)]`}>vs {o.opponent} · {mapLabel(o.mapName)} · {o.score}{o.round ? ` · R${o.round}` : ""}</Link>
          {o.kind === "economy" && <span className="block tabular-nums text-[var(--color-fg-mid)]">胜方 ${o.winnerEquipment?.toLocaleString("en-US")} · 负方 ${o.loserEquipment?.toLocaleString("en-US")}</span>}
        </li>)}</ul>
        {record.pages > 1 && <nav aria-label={`${record.label} 并列纪录分页`} className="mt-3 flex items-center gap-4 text-xs">
          {record.page > 1 && <Link href={statsHref(seasonSlug, query, { recordPage: record.page - 1 })} scroll={false} className={`${linkStyle} py-2`}>上一页</Link>}
          <span className="tabular-nums">{record.page}/{record.pages}</span>
          {record.page < record.pages && <Link href={statsHref(seasonSlug, query, { recordPage: record.page + 1 })} scroll={false} className={`${linkStyle} py-2`}>下一页</Link>}
        </nav>}
      </details>
    </>}
  </div>;
}

export function Records({ records, query, seasonSlug, coverage, events, counts, eventMaps = 0 }: {
  records: RecordSummary[]; query: StatsQuery; seasonSlug: string;
  coverage?: { maps: number; economyRounds: number }; events?: RecordEventPage;
  counts?: Record<RecordEventKind, number>; eventMaps?: number;
}) {
  const router = useRouter();
  return <section aria-labelledby="records-heading" className="min-w-0 space-y-7">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="records-heading" className="pr-4 text-base font-semibold"><Help label="Records">按当前范围的已确认数据计算，包含加时。4K 为恰好四次对敌击杀，Ace 为五次；两者分别计数。累计纪录合并当前范围内的地图。经济纪录按开局装备价值计算；道具伤害为单人单回合 HE 与燃烧伤害之和。</Help></h2>
      {coverage && <span className="pr-4 text-xs tabular-nums text-[var(--color-fg-mid)]"><Help label={`${coverage.maps} 张地图`}>已确认的纪录覆盖；事件覆盖 {eventMaps} 张地图，经济数据覆盖 {coverage.economyRounds} 回合。缺少事实的地图不计入事件数量。</Help></span>}
    </div>
    <nav aria-label="事件数量" className="grid grid-cols-2 gap-px overflow-hidden border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-4 xl:grid-cols-7">
      {summaryKinds.map(kind => <Link key={kind} href={`${statsHref(seasonSlug, query, { eventType: kind })}#record-events` as Route} scroll={false} className={`flex min-w-0 items-baseline justify-between gap-2 bg-[var(--color-panel-low)] px-3 py-3 ${linkStyle}`}>
        <span className="text-xs text-[var(--color-fg-mid)]">{RECORD_EVENT_NAMES[kind]}</span><span className="text-xl font-semibold tabular-nums">{eventMaps ? counts?.[kind] ?? "—" : "—"}</span>
      </Link>)}
    </nav>
    <div className="grid min-w-0 gap-x-8 gap-y-6 lg:grid-cols-3">{groups.map(group => <section key={group.label} className="min-w-0" aria-label={group.label}>
      <h3 className="border-b border-[var(--color-border-hi)] pb-2 text-sm font-semibold">{group.label}</h3>
      <div className="divide-y divide-[var(--color-border)]">{records.filter(record => group.kinds.includes(record.kind)).map(record => <RecordRow key={record.kind} record={record} query={query} seasonSlug={seasonSlug} />)}</div>
    </section>)}</div>
    <section id="record-events" aria-labelledby="record-events-heading" className="min-w-0 scroll-mt-24 space-y-3 border-t border-[var(--color-border-hi)] pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="record-events-heading" className="pr-4 text-base font-semibold"><Help label="事件目录">逐条浏览当前范围内的客观事件。比分为回合开始前双方比分；点击地图或回合进入比赛详情。环境致死行中的选手为受害者。</Help></h3><span className="text-xs tabular-nums text-[var(--color-fg-mid)]">{events ? `${events.total} 项` : "—"}</span></div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-0 gap-1 text-xs text-[var(--color-fg-mid)]">类型<select value={query.eventType ?? ""} onChange={event => navigateStatsScope(router, seasonSlug, query, { eventType: event.target.value as RecordEventKind | "" })} className={selectStyle}>
          <option value="">全部事件</option>{(Object.entries(RECORD_EVENT_NAMES) as [RecordEventKind, string][]).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}
        </select></label>
        <label className="grid min-w-0 gap-1 text-xs text-[var(--color-fg-mid)]">武器<select value={query.eventWeapon ?? ""} onChange={event => navigateStatsScope(router, seasonSlug, query, { eventWeapon: event.target.value })} className={selectStyle}>
          <option value="">全部武器</option>{events?.weapons.map(weapon => <option key={weapon} value={weapon}>{displayWeaponName(weapon)}</option>)}
        </select></label>
        {(query.eventType || query.eventWeapon) && <Link href={statsHref(seasonSlug, query, { eventType: "", eventWeapon: "" })} scroll={false} className={`${linkStyle} py-2.5 text-xs`}>清除筛选</Link>}
      </div>
      {!events?.rows.length ? <p className="border-y border-[var(--color-border)] py-10 text-center text-sm text-[var(--color-fg-mid)]">{eventMaps ? "暂无匹配事件" : "暂无事件数据"}</p> : <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
        <div className="hidden grid-cols-[5rem_minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 py-2 text-xs text-[var(--color-fg-dim)] md:grid"><span>事件</span><span>选手 / 队伍</span><span>对手 / 赛事</span><span>地图 / 回合</span><span>武器 / 受害者</span></div>
        {events.rows.map(event => <article key={`${event.mapId}:${event.id}`} className="grid min-w-0 gap-x-4 gap-y-2 py-3 text-sm md:grid-cols-[5rem_minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <span className="w-fit self-start border border-[var(--color-border)] px-2 py-1 text-xs font-medium">{RECORD_EVENT_NAMES[event.kind]}</span>
          <div className="min-w-0 space-y-1 break-words"><Link href={`/players/${event.entityId}` as Route} className={`${linkStyle} font-medium`}>{event.entityName}</Link><Link href={event.teamHref as Route} className={`${linkStyle} block text-xs text-[var(--color-fg-mid)]`}>{event.teamName}</Link></div>
          <div className="min-w-0 space-y-1 break-words"><Link href={event.opponentHref as Route} className={linkStyle}>vs {event.opponent}</Link><Link href={`/${event.eventSlug}` as Route} className={`${linkStyle} block text-xs text-[var(--color-fg-mid)]`}>{event.eventName}</Link></div>
          <Link href={`/${event.eventSlug}/matches/${event.matchId}` as Route} className={`${linkStyle} space-y-1`}><span className="block">{mapLabel(event.mapName)} <span className="font-medium tabular-nums">R{event.round}</span></span><span className="block text-xs tabular-nums text-[var(--color-fg-mid)]">{event.score}</span></Link>
          <div className="min-w-0 space-y-1 break-words text-xs text-[var(--color-fg-mid)]"><span>{event.weapon ? displayWeaponName(event.weapon) : event.weapons?.map(displayWeaponName).join(" / ") || "—"}</span>{event.victimId && event.kind !== "world" && event.kind !== "suicide" && <Link href={`/players/${event.victimId}` as Route} className={`${linkStyle} block`}>→ {event.victimName}</Link>}</div>
        </article>)}
      </div>}
      {events && events.pages > 1 && <nav aria-label="事件分页" className="flex flex-wrap items-center justify-between gap-3 text-sm">
        {events.page > 1 ? <Link href={statsHref(seasonSlug, query, { eventPage: events.page - 1 })} scroll={false} className={`${linkStyle} py-2`}>上一页</Link> : <span />}
        <span className="text-xs tabular-nums text-[var(--color-fg-mid)]">{events.page} / {events.pages}</span>
        {events.page < events.pages ? <Link href={statsHref(seasonSlug, query, { eventPage: events.page + 1 })} scroll={false} className={`${linkStyle} py-2`}>下一页</Link> : <span />}
      </nav>}
    </section>
  </section>;
}
