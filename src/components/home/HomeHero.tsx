import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { PublicSeason } from "@/lib/data/public-seasons";
import type { HomeEyebrow, HomeNavEntry } from "@/lib/home/navigation";

export function HomeHero({ season, eyebrow, primary, stageLabel, teamCount, playerCount }: {
  season: PublicSeason;
  eyebrow: HomeEyebrow;
  primary: HomeNavEntry | null;
  stageLabel: string | null;
  teamCount: number;
  playerCount: number;
}) {
  return <section className="home-event-hero relative isolate overflow-hidden rounded-[var(--radius-display)] border border-[var(--color-border)] bg-[var(--color-panel)]">
    <div aria-hidden className="home-event-art pointer-events-none absolute inset-y-0 right-0 w-[48%]">
      <Image src="/brand/rivalhub/rivalhub-symbol-color-transparent-tight.png" alt="" fill sizes="(min-width: 1440px) 620px, 45vw" priority className="object-contain p-10" />
    </div>
    <div className="relative z-10 grid min-h-[440px] content-between gap-10 p-6 sm:p-10 lg:p-12">
      <div className="max-w-[760px]">
        <p className="mb-6 font-mono text-xs tracking-[0.18em] text-[var(--color-accent)]">RIVALHUB / COMPETE TOGETHER</p>
        <p className="mb-4 flex items-center gap-2 text-sm font-medium text-[var(--color-fg-mid)]"><span aria-hidden className="size-1.5 rounded-full bg-[var(--color-accent)]" />{stageLabel ?? eyebrow.text.replace(/^●\s*/, "")}</p>
        <h1 className="max-w-[18ch] text-[clamp(36px,4.5vw,72px)] font-bold leading-[1.06] tracking-tight text-[var(--color-fg)] [overflow-wrap:anywhere]">{season.name}</h1>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {primary && <Button size="lg" asChild><Link href={primary.href as never}>{(["finished", "archived"].includes(season.status) ? "赛事回顾" : primary.label)} <span aria-hidden>↗</span></Link></Button>}
          <Button size="lg" variant="outline" asChild><Link href={`/${season.slug}`}>赛事总览</Link></Button>
        </div>
      </div>
      <dl className="flex flex-wrap gap-x-10 gap-y-4 border-t border-[var(--color-border-hi)] pt-5 text-sm">
        <div><dt className="mb-1 text-xs text-[var(--color-fg-mid)]">参赛队伍</dt><dd className="font-mono text-xl font-semibold tabular-nums">{teamCount}</dd></div>
        <div><dt className="mb-1 text-xs text-[var(--color-fg-mid)]">本届选手</dt><dd className="font-mono text-xl font-semibold tabular-nums">{playerCount}</dd></div>
        <div><dt className="mb-1 text-xs text-[var(--color-fg-mid)]">参与方式</dt><dd className="pt-1">{season.registrationMode === "team" ? "组队参赛" : ["个人报名", ...(season.hasCaptainVoting ? ["队长投票"] : []), ...(season.hasDraft ? ["蛇形选秀"] : [])].join(" · ")}</dd></div>
      </dl>
    </div>
  </section>;
}
