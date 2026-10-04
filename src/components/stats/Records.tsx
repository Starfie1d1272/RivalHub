import React from "react";
import Link from "next/link";
import type { Route } from "next";
import type { RecordSummary } from "@/lib/stats/records";
import { statsHref, type StatsQuery } from "@/lib/stats/view-state";
export function Records({ records, query, seasonSlug, coverage }: { records: RecordSummary[]; query: StatsQuery; seasonSlug: string; coverage?: { maps: number; economyRounds: number } }) {
  return <section aria-labelledby="records-heading" className="space-y-4">
    <h2 id="records-heading" className="text-base font-semibold">当前范围纪录</h2>
    <p className="text-xs leading-5 text-[var(--color-fg-mid)]">仅在完整、当前有效的已确认数据中比较，含加时。{coverage ? `可追溯地图 ${coverage.maps} 张；装备值已知且取样时点已验证的回合 ${coverage.economyRounds} 个。` : "缺少所需数据时不生成纪录。"}覆盖不完整时不代表完整平台历史最高；装备差值不等于取胜难度。</p>
    {([{ label: "Performance", kinds: ["kills", "adr", "firstKills", "tradeKills"] }, { label: "Clutch", kinds: ["clutch"] }, { label: "Rounds", kinds: ["economy"] }]).map((group) => <section key={group.label} className="space-y-2">
      <h3 className="text-sm font-semibold">{group.label}</h3>
      <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">{records.filter((r) => group.kinds.includes(r.kind)).map((record) => <div key={record.kind} className="py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-sm font-medium">{record.label}</h4><span className="font-semibold tabular-nums">{record.value === null ? "—" : record.kind === "clutch" ? `1v${record.value}` : record.kind === "adr" ? record.value.toFixed(1) : record.kind === "economy" ? `$${record.value}` : record.value}</span></div>
        {record.value === null ? <p className="mt-1 text-xs text-[var(--color-fg-mid)]">暂无满足所需完整数据的纪录</p> : <details className="mt-2" open={record.occurrenceCount === 1}>
          <summary className="cursor-pointer text-xs text-[var(--color-fg-mid)]">{record.holders.map((h) => h.name).join(" / ")}{record.holderCount > record.holders.length ? ` 等 ${record.holderCount} 位保持者` : ""} · {record.occurrenceCount} 次并列发生 · 查看来源</summary>
          <ul className="mt-2 space-y-3 text-xs">{record.occurrences.map((o) => <li key={`${o.mapId}:${o.round ?? 0}:${o.entityId}`} className="flex flex-wrap gap-x-3 gap-y-1 leading-5">
            <Link href={o.entityHref as Route} className="font-medium hover:text-[var(--color-accent)]">{o.entityName}</Link><Link href={`/${o.eventSlug}` as Route}>{o.eventName}</Link>
            <Link href={`/${o.eventSlug}/matches/${o.matchId}` as Route} className="hover:text-[var(--color-accent)]">vs {o.opponent} · {o.mapName} · {o.score}{o.round ? ` · R${o.round}` : ` · ${o.rounds} rounds`}</Link>
            {o.kind === "economy" && <span>freeze-end：胜方 ${o.winnerEquipment} / 败方 ${o.loserEquipment} / 差值 {o.numerator}</span>}
          </li>)}</ul>
          {record.pages > 1 && <nav aria-label={`${record.label} 并列纪录分页`} className="mt-3 flex gap-4 text-xs">
            {record.page > 1 && <Link href={statsHref(seasonSlug, query, { recordPage: record.page - 1 })} scroll={false}>上一页</Link>}
            <span>{record.page}/{record.pages} · 每页最多 10 次</span>
            {record.page < record.pages && <Link href={statsHref(seasonSlug, query, { recordPage: record.page + 1 })} scroll={false}>下一页</Link>}
          </nav>}
        </details>}
      </div>)}</div>
    </section>)}
  </section>;
}
