import React from "react";
import Link from "next/link";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import type { Route } from "next";
import type { RecordSummary } from "@/lib/stats/records";
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function Records({ records, query, seasonSlug, coverage }: { records: RecordSummary[]; query: StatsQuery; seasonSlug: string; coverage?: { maps: number; economyRounds: number } }) {
  return <section aria-labelledby="records-heading" className="space-y-4">
    <h2 id="records-heading" className="text-base font-semibold"><span className="relative inline-block">Records<HelpTooltip className="absolute left-full top-1/2 ml-1 -translate-y-1/2" label="Records 说明" content="按当前范围已确认的数据计算，包含加时。经济纪录使用回合开始时的装备价值。" /></span></h2>
    {coverage && <p className="text-xs text-[var(--color-fg-mid)]">Coverage · {plural(coverage.maps, "map")} · {plural(coverage.economyRounds, "economy round")}</p>}
    {([{ label: "Performance", kinds: ["kills", "adr", "firstKills", "tradeKills"] }, { label: "Clutch", kinds: ["clutch"] }, { label: "Rounds", kinds: ["economy"] }]).map((group) => <section key={group.label} className="space-y-2">
      <h3 className="text-sm font-semibold">{group.label}</h3>
      <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">{records.filter((r) => group.kinds.includes(r.kind)).map((record) => <div key={record.kind} className="py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-sm font-medium">{record.label}</h4><span className="font-semibold tabular-nums">{record.value === null ? "—" : record.kind === "clutch" ? `1v${record.value}` : record.kind === "adr" ? record.value.toFixed(1) : record.kind === "economy" ? `$${record.value}` : record.value}</span></div>
        {record.value !== null && <details className="mt-2" open={record.occurrenceCount === 1}>
          <summary className="cursor-pointer text-xs text-[var(--color-fg-mid)]">{record.holders.map((h) => h.name).join(" / ")}{record.holderCount > record.holders.length ? ` · ${plural(record.holderCount, "holder")}` : ""} · {plural(record.occurrenceCount, "occurrence")} · Sources</summary>
          <ul className="mt-2 space-y-3 text-xs">{record.occurrences.map((o) => <li key={`${o.mapId}:${o.round ?? 0}:${o.entityId}`} className="flex flex-wrap gap-x-3 gap-y-1 leading-5">
            <Link href={o.entityHref as Route} className="font-medium hover:text-[var(--color-accent)]">{o.entityName}</Link><Link href={`/${o.eventSlug}` as Route}>{o.eventName}</Link>
            <Link href={`/${o.eventSlug}/matches/${o.matchId}` as Route} className="hover:text-[var(--color-accent)]">vs {o.opponent} · {o.mapName} · {o.score}{o.round ? ` · R${o.round}` : ` · ${plural(o.rounds, "round")}`}</Link>
            {o.kind === "economy" && <span>Equipment · Winner ${o.winnerEquipment} · Loser ${o.loserEquipment} · Gap ${o.numerator}</span>}
          </li>)}</ul>
          {record.pages > 1 && <nav aria-label={`${record.label} 并列纪录分页`} className="mt-3 flex gap-4 text-xs">
            {record.page > 1 && <Link href={statsHref(seasonSlug, query, { recordPage: record.page - 1 })} scroll={false}>上一页</Link>}
            <span>{record.page}/{record.pages}</span>
            {record.page < record.pages && <Link href={statsHref(seasonSlug, query, { recordPage: record.page + 1 })} scroll={false}>下一页</Link>}
          </nav>}
        </details>}
      </div>)}</div>
    </section>)}
  </section>;
}
