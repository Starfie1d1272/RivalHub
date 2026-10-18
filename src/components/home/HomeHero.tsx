import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { PublicSeason } from "@/lib/data/public-seasons";
import type { HomeEyebrow, HomeNavEntry } from "@/lib/home/navigation";
import { presentSeasonStatus } from "@/lib/seasons/presentation";

interface HomeHeroProps {
  season: Pick<PublicSeason, "name" | "slug" | "status" | "registrationMode"> &
    Partial<Pick<PublicSeason, "hasCaptainVoting" | "hasDraft">>;
  eyebrow: HomeEyebrow;
  primary: HomeNavEntry | null;
  stageLabel: string | null;
  teamCount: number;
  playerCount: number;
  teamCountLabel: string;
}

export function HomeHero({ season, eyebrow, primary, stageLabel, teamCount, playerCount, teamCountLabel }: HomeHeroProps) {
  const historical = ["finished", "archived"].includes(season.status);
  const statusLabel = historical ? presentSeasonStatus(season.status).label : stageLabel ?? eyebrow.text.replace(/^●\s*/, "");
  const overviewHref = `/${season.slug}`;
  const participation = season.registrationMode === "team"
    ? "组队参赛"
    : ["个人报名", ...(season.hasCaptainVoting ? ["队长投票"] : []), ...(season.hasDraft ? ["蛇形选秀"] : [])].join(" · ");

  return (
    <section aria-labelledby="home-event-title" className="home-event-hero relative isolate overflow-hidden rounded-[var(--radius-display)] border border-[var(--color-border)] bg-[var(--color-panel)]">
      <div className="grid gap-6 p-6 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <p className="font-mono text-[11px] tracking-[0.2em] text-[var(--color-fg-mid)]">RIVALHUB <span className="mx-2 text-[var(--color-accent)]">/</span> CAMPUS COUNTER-STRIKE</p>
          <p className="flex items-center gap-2 text-sm font-medium text-[var(--color-fg-mid)]">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--color-accent)]" />{statusLabel}
          </p>
        </div>
        <div className="grid items-end gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-10">
          <div className="min-w-0">
            <h1 id="home-event-title" className="text-balance text-[clamp(34px,4.7vw,70px)] font-bold leading-[1.08] tracking-tight text-[var(--color-fg)] [overflow-wrap:anywhere]">{season.name}</h1>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {primary && <Button size="lg" asChild><Link href={primary.href as never}>{primary.label} <span aria-hidden="true">↗</span></Link></Button>}
              {primary?.href !== overviewHref && <Button size="lg" variant="outline" asChild><Link href={`/${season.slug}`}>赛事总览</Link></Button>}
            </div>
          </div>
          <dl className="flex flex-wrap items-end gap-x-8 gap-y-4 border-t border-[var(--color-border-hi)] pt-4 text-sm lg:grid lg:grid-cols-2 lg:border-t-0 lg:border-l lg:pb-1 lg:pl-8 lg:pt-0">
            {(season.registrationMode === "team" || teamCount > 0) && <div className="flex items-baseline gap-3"><dt className="text-xs text-[var(--color-fg-mid)]">{teamCountLabel}</dt><dd className="font-mono text-2xl font-semibold tabular-nums">{teamCount}</dd></div>}
            <div className="flex items-baseline gap-3"><dt className="text-xs text-[var(--color-fg-mid)]">本届选手</dt><dd className="font-mono text-2xl font-semibold tabular-nums">{playerCount}</dd></div>
            <div className="basis-full lg:col-span-2"><dt className="sr-only">参与方式</dt><dd className="text-xs text-[var(--color-fg-mid)]">{participation}</dd></div>
          </dl>
        </div>
      </div>
    </section>
  );
}
