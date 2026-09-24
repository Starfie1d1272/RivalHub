import { Suspense, type ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { PageLayout, PosChip } from "@/components/rivalhub";
import { MapPreferenceChips } from "@/components/rivalhub/MapPreferenceChips";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { PlayerPerformanceFilters } from "@/components/players/PlayerPerformanceFilters";
import { PlayerAttributes } from "@/components/players/PlayerAttributes";
import { PlayerWorkspace } from "@/components/stats/players/PlayerWorkspace";
import { MetricValue } from "@/components/stats/MetricValue";
import { StatsMetricLabel } from "@/components/stats/StatsMetricHelp";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { resolveCanonicalUserId } from "@/lib/identity/canonical";
import { PUBLIC_PLAYER_INFO_FIELDS } from "@/lib/utils/player-info-fields";
import { POSITION_LABELS } from "@/lib/validators/registration";
import { getPublicPlayerProfileReadModel } from "@/lib/players/public-profile";
import { parsePlayerPerformanceQuery, type PlayerPerformanceSearch } from "@/lib/players/performance-view-state";
import { db } from "@/db/client";

interface PlayerPageProps {
  params: Promise<{ userId: string }>;
  searchParams: Promise<PlayerPerformanceSearch>;
}

function pct(numerator: number, denominator: number) {
  if (denominator === 0) return "—";
  return Math.round((numerator / denominator) * 100) + "%";
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <div className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">{children}</div>;
}

export default function PlayerPage({ params, searchParams }: PlayerPageProps) {
  return (
    <Suspense fallback={<PlayerPageFallback />}>
      <PlayerPageContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

export async function PlayerPageContent({ params, searchParams }: PlayerPageProps) {
  const [{ userId }, rawSearch] = await Promise.all([params, searchParams]);
  const canonicalUserId = await resolveCanonicalUserId(db, userId);
  if (!canonicalUserId) notFound();
  if (canonicalUserId !== userId) redirect(`/players/${canonicalUserId}`);

  const query = parsePlayerPerformanceQuery(rawSearch);
  const profile = await getPublicPlayerProfileReadModel(userId, {
    eventSlug: query.event || undefined,
    mapFilter: query.map || undefined,
  });
  if (!profile) notFound();
  if (query.event && !profile.career.selectedEvent) redirect(`/players/${userId}`);
  if (query.map && !profile.career.mapFilter) {
    redirect(query.event
      ? `/players/${userId}?event=${encodeURIComponent(query.event)}`
      : `/players/${userId}`);
  }

  const { user, career } = profile;
  const score = career.scoreboard[0];
  const registrationBySeasonId = new Map(profile.registrationSnapshots.map((registration) => [registration.seasonId, registration]));
  const careerSeasonIds = new Set(profile.careerHistory.map((entry) => entry.seasonId));
  const standaloneRegistrationSnapshots = profile.registrationSnapshots.filter((registration) => !careerSeasonIds.has(registration.seasonId));
  const teamBySeasonId = new Map(profile.eventTeams.map((entry) => [entry.seasonId, entry]));
  const hasDeclaredProfile = profile.publicCompetitiveProfile.length > 0
    || profile.mapPreferences.length > 0
    || Boolean(user.gameplayStyle?.trim() || user.competitionHistory?.trim());

  const renderRegistrationSnapshot = (registration: (typeof profile.registrationSnapshots)[number]) => {
    const teamInfo = teamBySeasonId.get(registration.seasonId);
    const position = POSITION_LABELS[registration.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? registration.primaryPosition;
    const peak = [
      registration.peakRank + " (" + registration.peakRankSeason + ")",
      "Rating " + registration.peakRating.toFixed(2),
    ];
    if (registration.peakWe != null) peak.push("WE " + registration.peakWe.toFixed(1));

    return (
      <details className="group border-t border-[var(--color-border)] pt-3">
        <summary className="cursor-pointer list-none text-xs text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-fg)]">
          <span className="inline-flex items-center gap-2">
            <span>报名档案（报名时资料）</span>
            <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
          </span>
        </summary>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[var(--color-fg-mid)]">
          <PosChip pos={position} />
          <span>{peak.join(" · ")}</span>
          {teamInfo && (
            <Link
              href={`/${teamInfo.seasonSlug}/teams/${teamInfo.teamId}`}
              className="transition-colors hover:text-[var(--color-accent)]"
            >
              {teamInfo.teamName} ↗
            </Link>
          )}
          {registration.highlightVideoUrl && (
            <a
              href={registration.highlightVideoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-accent)] hover:underline"
            >
              高光视频 ↗
            </a>
          )}
        </div>
      </details>
    );
  };

  return (
    <PageLayout variant="standard" className="space-y-12">
      <section className="border-b border-[var(--color-border)] pb-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <PlayerAvatar name={getPublicDisplayName(user)} avatarUrl={user.avatarUrl} size="lg" />
          <div className="min-w-0 flex-1 space-y-4">
            <div className="space-y-2">
              <h1 className="text-3xl font-black text-[var(--color-fg)]">{getPublicDisplayName(user)}</h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-fg-mid)]">
                {user.perfectName && <span className="font-mono">完美平台 · {user.perfectName}</span>}
                {user.steamProfileUrl && (
                  <a
                    href={user.steamProfileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-colors hover:text-[var(--color-accent)]"
                  >
                    Steam ↗
                  </a>
                )}
              </div>
            </div>

            {profile.publicEducationIdentities.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-fg-mid)]">
                <span className="font-mono text-[var(--color-fg-dim)]">高校身份</span>
                {profile.publicEducationIdentities.map((education) => (
                  <span key={education.institutionName}>
                    {education.institutionName} · {education.academicStatus} · {education.verificationLabel}
                  </span>
                ))}
              </div>
            )}

            {profile.publicCompetitiveRoles.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {profile.publicCompetitiveRoles.map((role) => <PosChip key={role} pos={role} />)}
              </div>
            )}

            <div className="grid gap-3 border-t border-[var(--color-border)] pt-4 text-sm sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-dim)]">当前活动</p>
                <div className="space-y-1.5">
                  {profile.currentTeams.map((team) => (
                    <Link
                      key={team.slug}
                      className="block font-semibold transition-colors hover:text-[var(--color-accent)]"
                      href={`/teams/${team.slug}`}
                    >
                      {team.name} →
                    </Link>
                  ))}
                  {profile.currentEventTeams.map((entry) => (
                    <Link
                      key={entry.teamId}
                      className="block text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-accent)]"
                      href={`/${entry.seasonSlug}/teams/${entry.teamId}`}
                    >
                      {entry.seasonName} · {entry.teamName} →
                    </Link>
                  ))}
                  {profile.currentTeams.length === 0 && profile.currentEventTeams.length === 0 && (
                    <p className="text-[var(--color-fg-mid)]">暂无当前赛事或队伍</p>
                  )}
                </div>
              </div>

              {profile.playerLft && (
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-dim)]">正在找队</p>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {profile.playerLft.positions.map((position) => <PosChip key={position} pos={position} />)}
                    </div>
                    {profile.playerLft.targetSeasonName && (
                      <p className="text-[var(--color-fg-mid)]">目标赛事 · {profile.playerLft.targetSeasonName}</p>
                    )}
                    {profile.playerLft.note && (
                      <p className="line-clamp-2 text-[var(--color-fg-mid)]">{profile.playerLft.note}</p>
                    )}
                    <Link href="/teams/recruitment?view=players" className="text-[var(--color-accent)]">
                      查看组队大厅 →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 border-y border-[var(--color-border)] sm:grid-cols-4">
          <div className="px-3 py-3 sm:first:pl-0">
            <dt className="text-[11px] text-[var(--color-fg-mid)]"><StatsMetricLabel metric="rating">Rating</StatsMetricLabel></dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums"><MetricValue metric="rating" value={score?.avgRating ?? null} /></dd>
          </div>
          <div className="border-l border-[var(--color-border)] px-3 py-3">
            <dt className="text-[11px] text-[var(--color-fg-mid)]"><StatsMetricLabel metric="adr">ADR</StatsMetricLabel></dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums"><MetricValue metric="adr" value={score?.avgAdr ?? null} /></dd>
          </div>
          <div className="border-l border-[var(--color-border)] px-3 py-3">
            <dt className="text-[11px] text-[var(--color-fg-mid)]"><StatsMetricLabel metric="kd">K/D</StatsMetricLabel></dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums"><MetricValue metric="kd" value={score?.kdRatio ?? null} /></dd>
          </div>
          <div className="border-l border-[var(--color-border)] px-3 py-3">
            <dt className="text-[11px] text-[var(--color-fg-mid)]">Maps</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{career.summary.maps}</dd>
          </div>
        </dl>
      </section>

      <section className="space-y-5" aria-labelledby="player-career-heading">
        <div className="space-y-1">
          <SectionHeading>Career</SectionHeading>
          <h2 id="player-career-heading" className="text-xl font-semibold text-[var(--color-fg)]">赛事履历</h2>
        </div>

        {profile.careerHistory.length > 0 ? (
          <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {profile.careerHistory.map((entry) => {
              const registration = registrationBySeasonId.get(entry.seasonId);
              return (
                <article key={entry.seasonId + ":" + entry.teamId} className="py-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <Link
                          className="font-semibold transition-colors hover:text-[var(--color-accent)]"
                          href={`/${entry.seasonSlug}/teams/${entry.teamId}`}
                        >
                          {entry.seasonName}
                        </Link>
                        <span className="text-sm text-[var(--color-fg-mid)]">{entry.teamName}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-fg-mid)]">
                        {entry.placement && <span>{entry.placement}</span>}
                        <span>{entry.record.played} 场 · {entry.record.wins} 胜 / {entry.record.losses} 负</span>
                        {entry.honors.map((honor) => <span key={honor}>官方荣誉 · {honor}</span>)}
                      </div>
                    </div>
                    <Link
                      href={`/${entry.seasonSlug}/stats?tab=players&teamFilter=${entry.teamId}`}
                      className="shrink-0 text-xs text-[var(--color-accent)]"
                    >
                      赛事选手统计 →
                    </Link>
                  </div>
                  {registration && <div className="mt-4">{renderRegistrationSnapshot(registration)}</div>}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-fg-mid)]">暂无已结束赛事记录</p>
        )}

        {standaloneRegistrationSnapshots.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-[var(--color-fg-dim)]">其它报名记录</p>
            <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
              {standaloneRegistrationSnapshots.map((registration) => (
                <div key={registration.id} className="py-4">
                  <p className="mb-3 text-sm font-semibold">{registration.seasonName}</p>
                  {renderRegistrationSnapshot(registration)}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {hasDeclaredProfile && (
        <section className="space-y-5" aria-labelledby="player-profile-heading">
          <div className="space-y-1">
            <SectionHeading>Profile</SectionHeading>
            <h2 id="player-profile-heading" className="text-xl font-semibold">长期资料</h2>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            {profile.publicCompetitiveProfile.length > 0 && (
              <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
                <h3 className="text-sm font-semibold">竞技档案</h3>
                <div className="space-y-4 text-sm">
                  {profile.publicCompetitiveProfile.map((platform) => (
                    <div key={platform.displayName} className="space-y-2">
                      <p className="font-semibold text-[var(--color-fg)]">{platform.displayName}</p>
                      {platform.facts.map((fact) => (
                        <p key={platform.displayName + "-" + fact.label}>
                          <span className="text-[var(--color-fg-mid)]">{fact.label}</span>
                          {" · "}{fact.rankLabel}
                          {fact.stars !== null ? " " + fact.stars + " 星" : ""}
                          {fact.ratingLabel && fact.rating !== null ? " · " + fact.ratingLabel + " " + fact.rating : ""}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
              <h3 className="text-sm font-semibold">地图熟练度</h3>
              <MapPreferenceChips preferences={profile.mapPreferences} minLevel="none" showUnfilled />
              {profile.mapPreferences.length === 0 && (
                <p className="text-sm text-[var(--color-fg-mid)]">暂无长期地图熟练度资料</p>
              )}
            </div>
          </div>

          {(user.gameplayStyle?.trim() || user.competitionHistory?.trim()) && (
            <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
              <h3 className="text-sm font-semibold">选手自述</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {PUBLIC_PLAYER_INFO_FIELDS
                  .map(({ key, label }) => ({ value: user[key]?.trim(), label }))
                  .filter((entry) => entry.value)
                  .map(({ value, label }) => (
                    <div key={label}>
                      <span className="font-mono text-xs font-semibold text-[var(--color-fg-mid)]">{label}</span>
                      <p className="mt-1 text-sm leading-6 text-[var(--color-fg)]">{value}</p>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="space-y-5" aria-labelledby="player-performance-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <SectionHeading>Performance</SectionHeading>
            <h2 id="player-performance-heading" className="text-xl font-semibold">
              竞技表现 <span className="text-sm font-normal text-[var(--color-fg-mid)]">· {career.selectedEvent?.name ?? "All-time"}</span>
            </h2>
          </div>
          <PlayerPerformanceFilters userId={userId} events={career.events} query={query} />
        </div>

        {career.coverage.completedMaps > 0 && career.coverage.detailedMaps < career.coverage.completedMaps && (
          <p className="text-xs text-[var(--color-fg-mid)]">
            详细数据覆盖 {career.coverage.detailedMaps}/{career.coverage.completedMaps} 张地图
          </p>
        )}

        <dl className="grid grid-cols-2 border-y border-[var(--color-border)] sm:grid-cols-4">
          <div className="px-3 py-3 sm:first:pl-0">
            <dt className="text-[11px] text-[var(--color-fg-mid)]">Matches</dt>
            <dd className="mt-1 font-semibold tabular-nums">{career.summary.matches}</dd>
            <p className="text-xs text-[var(--color-fg-dim)]">{career.summary.wins}–{career.summary.losses} · {pct(career.summary.wins, career.summary.matches)}</p>
          </div>
          <div className="border-l border-[var(--color-border)] px-3 py-3">
            <dt className="text-[11px] text-[var(--color-fg-mid)]">Maps</dt>
            <dd className="mt-1 font-semibold tabular-nums">{career.summary.maps}</dd>
          </div>
          <div className="border-l border-[var(--color-border)] px-3 py-3">
            <dt className="text-[11px] text-[var(--color-fg-mid)]">Rounds</dt>
            <dd className="mt-1 font-semibold tabular-nums">{career.summary.rounds}</dd>
          </div>
          <div className="border-l border-[var(--color-border)] px-3 py-3">
            <dt className="text-[11px] text-[var(--color-fg-mid)]">MVP</dt>
            <dd className="mt-1 font-semibold tabular-nums">{career.summary.mvp > 0 ? career.summary.mvp : "—"}</dd>
          </div>
        </dl>

        {profile.attributes && <PlayerAttributes profile={profile.attributes} />}

        <PlayerWorkspace detail={career} compact />
      </section>

    </PageLayout>
  );
}

function PlayerPageFallback() {
  return (
    <PageLayout variant="standard" className="min-h-[60vh]" aria-busy="true">
      <span className="sr-only">正在加载选手页面…</span>
    </PageLayout>
  );
}
