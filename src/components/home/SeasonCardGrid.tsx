import { EventLogo } from "@/components/season/EventLogo";
import Link from "next/link";
import type { RegistrationMode, SeasonStatus } from "@/types/season";
import { presentRegistrationSchedule, presentSeasonKind, presentSeasonParticipationState } from "@/lib/seasons/presentation";
import { Marker, StatusPill } from "@/components/rivalhub";

interface SeasonCard {
  id: string;
  name: string;
  logoUrl?: string | null;
  slug: string;
  kind: string;
  status: SeasonStatus;
  registrationMode?: RegistrationMode;
  hasOfficialMatches?: boolean;
  registrationOpensAt?: Date | null;
  registrationOpenedAt?: Date | null;
  registrationClosesAt?: Date | null;
}

interface SeasonCardGridProps {
  markerNum: number;
  markerSub: string;
  title: string;
  seasons: SeasonCard[];
  compact?: boolean;
}

export function SeasonCardGrid({ markerNum, markerSub, title, seasons, compact = false }: SeasonCardGridProps) {
  if (seasons.length === 0) return null;

  return (
    <section>
      <Marker num={markerNum} sub={markerSub}><h2>{title}</h2></Marker>
      <div className={compact ? "grid gap-x-8 sm:grid-cols-2" : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"}>
        {seasons.map((season) => {
          const registrationSeason = {
            ...season,
            registrationOpensAt: season.registrationOpensAt ?? null,
            registrationOpenedAt: season.registrationOpenedAt ?? null,
            registrationClosesAt: season.registrationClosesAt ?? null,
          };
          const participation = presentSeasonParticipationState(registrationSeason);
          const status = season.status === "registration" && season.hasOfficialMatches
            ? { label: "赛程已公布", tone: "accent" as const }
            : participation;
          const registrationSchedule = !season.hasOfficialMatches ? presentRegistrationSchedule(registrationSeason) : null;
          const participationLabel = season.registrationMode === "team" ? "组队参赛" : season.registrationMode === "solo" ? "个人报名" : null;

          if (compact) {
            return (
              <Link key={season.id} href={`/${season.slug}`} className="group flex min-w-0 items-center gap-3 border-t border-[var(--color-border)] py-4">
                <EventLogo logoUrl={season.logoUrl ?? null} className="h-9 w-9 shrink-0 object-contain" />
                <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold group-hover:text-[var(--color-accent)]" title={season.name}>{season.name}</h3><p className="mt-1 text-xs text-[var(--color-fg-mid)]">{presentSeasonKind(season.kind)} · {status.label}</p></div>
                <span aria-hidden="true" className="text-[var(--color-fg-dim)]">↗</span>
              </Link>
            );
          }

          return (
            <Link key={season.id} href={`/${season.slug}`} className="group flex min-w-0 flex-col rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-panel)] p-5 transition-colors hover:border-[var(--color-accent-edge)]">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2"><StatusPill {...status} /><span className="font-mono text-[11px] text-[var(--color-fg-dim)]">{presentSeasonKind(season.kind)}</span></div>
              <div className="flex min-w-0 items-center gap-3"><EventLogo logoUrl={season.logoUrl ?? null} className="h-12 w-12 shrink-0 object-contain" /><h3 className="min-w-0 text-xl font-semibold leading-snug group-hover:text-[var(--color-accent)] [overflow-wrap:anywhere]">{season.name}</h3></div>
              {registrationSchedule && <p className="mt-3 text-xs text-[var(--color-fg-mid)]">{registrationSchedule.primary}</p>}
              <div className="mt-auto flex items-center justify-between gap-3 pt-6 text-sm"><span className="text-[var(--color-fg-mid)]">{participationLabel}</span><span className="shrink-0 text-[var(--color-accent)]">查看赛事 <span aria-hidden="true">→</span></span></div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
