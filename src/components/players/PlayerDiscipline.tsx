import Link from "next/link";
import type { PublicPlayerSanction } from "@/lib/discipline/public-query";
import { SANCTION_EFFECT_LABELS } from "@/lib/discipline/contract";
import { formatCST } from "@/lib/utils/date";

function SanctionDetails({ sanction }: { sanction: PublicPlayerSanction }) {
  return <article className="space-y-2 py-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Link href={`/${sanction.seasonSlug}`} className="font-semibold hover:underline">{sanction.seasonName}</Link>
      <span className="text-xs">{sanction.status === "active" ? "生效中" : sanction.status === "revoked" ? "已撤销" : "已到期"}</span>
    </div>
    <p>{sanction.effects.map((effect) => SANCTION_EFFECT_LABELS[effect]).join(" · ")}</p>
    <p className="text-xs text-[var(--color-fg-mid)]">{formatCST(sanction.effectiveFrom)} — {sanction.effectiveUntil ? formatCST(sanction.effectiveUntil) : sanction.status === "active" ? "长期有效" : "未设截止"}</p>
    {sanction.explanation && <p className="whitespace-pre-wrap break-words text-[var(--color-fg-mid)]">{sanction.explanation}</p>}
  </article>;
}

export function PlayerActiveSanctions({ sanctions }: { sanctions: readonly PublicPlayerSanction[] }) {
  const active = sanctions.filter((sanction) => sanction.status === "active");
  if (!active.length) return null;
  return <section aria-labelledby="player-active-sanctions" className="border-l-2 border-[var(--color-danger)] bg-[var(--color-danger-soft)] px-4 py-3">
    <h2 id="player-active-sanctions" className="font-semibold text-[var(--color-danger)]">当前存在赛事纪律处罚</h2>
    <div className="divide-y divide-[var(--color-border)]">{active.map((sanction) => <SanctionDetails key={sanction.id} sanction={sanction} />)}</div>
  </section>;
}

export function PlayerDisciplineHistory({ sanctions }: { sanctions: readonly PublicPlayerSanction[] }) {
  const history = sanctions.filter((sanction) => sanction.status === "expired" || sanction.status === "revoked");
  if (!history.length) return null;
  return <section aria-labelledby="player-discipline-history" className="space-y-3">
    <h2 id="player-discipline-history" className="text-xl font-semibold">纪律记录</h2>
    <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)] text-[var(--color-fg-mid)]">{history.map((sanction) => <SanctionDetails key={sanction.id} sanction={sanction} />)}</div>
  </section>;
}
