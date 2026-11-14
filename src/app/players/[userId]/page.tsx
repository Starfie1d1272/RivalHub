import { ContentReady } from "@/components/telemetry/ContentReady";
import { HONOR_STATE_LABELS } from "@/lib/postevent/presentation";
import {
  PlayerActiveSanctions,
  PlayerDisciplineHistory,
} from "@/components/players/PlayerDiscipline";
import { safeStatsReturn } from "@/lib/stats/return-context";
import { StatsReturnLink } from "@/components/stats/StatsNavigationContext";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { statsEntryHref } from "@/lib/stats/view-state";
import { Suspense, type ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { PageLayout, PosChip } from "@/components/rivalhub";
import { MapPreferenceChips } from "@/components/rivalhub/MapPreferenceChips";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { PlayerProfileNav } from "@/components/players/PlayerProfileNav";
import { PlayerRecentMatches } from "@/components/players/PlayerMatches";
import { canonicalPlayerHref } from "@/lib/players/matches-view-state";
import { PlayerPerformanceFilters } from "@/components/players/PlayerPerformanceFilters";
import { PlayerAttributes } from "@/components/players/PlayerAttributes";
import { PlayerWorkspace } from "@/components/stats/players/PlayerWorkspace";
import { MetricValue } from "@/components/stats/MetricValue";
import { StatsMetricLabel } from "@/components/stats/StatsMetricHelp";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { resolveCanonicalUserId } from "@/lib/identity/canonical";
import { PUBLIC_PLAYER_INFO_FIELDS } from "@/lib/utils/player-info-fields";
import { POSITION_LABELS } from "@/lib/validators/registration";
import { getPublicPlayerById, type PublicPlayer } from "@/lib/data/public-players";
import { getPublicPlayerSanctions } from "@/lib/discipline/public-query";
import {
  createPublicPlayerProfileSections,
  type PublicPlayerProfileSections,
} from "@/lib/players/public-profile";
import {
  parsePlayerPerformanceQuery,
  parsePlayerProfileSection,
  playerProfileHref,
  type PlayerProfileSection,
  type PlayerPerformanceSearch,
} from "@/lib/players/performance-view-state";
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
  return (
    <div className="text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">
      {children}
    </div>
  );
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
  const fromStats = safeStatsReturn(
    typeof rawSearch.fromStats === "string" ? rawSearch.fromStats : null,
  );
  const canonicalUserId = await resolveCanonicalUserId(db, userId);
  if (!canonicalUserId) notFound();
  if (canonicalUserId !== userId)
    redirect(canonicalPlayerHref(canonicalUserId, rawSearch) as import("next").Route);

  const query = parsePlayerPerformanceQuery(rawSearch);
  const section = parsePlayerProfileSection(rawSearch.section);
  const [user, sanctions] = await Promise.all([
    getPublicPlayerById(userId),
    getPublicPlayerSanctions(userId),
  ]);
  if (!user) notFound();
  const sections = createPublicPlayerProfileSections(
    { user, sanctions },
    {
      eventSlug: query.event || undefined,
      mapFilter: query.map || undefined,
    },
  );
  return (
    <PageLayout variant="standard" className="space-y-6">
      <StatsReturnLink href={fromStats} />
      <PlayerIdentity
        user={user}
        hasActivePublicSanction={sanctions.some((sanction) => sanction.status === "active")}
      />
      <Suspense fallback={null}>
        <PlayerCurrentTeams sections={sections} />
      </Suspense>
      <PlayerProfileNav userId={userId} query={query} section={section} fromStats={fromStats} />
      <PlayerActiveSanctions sanctions={sanctions} />
      {section === "overview" && (
        <Suspense fallback={<ProfileSectionSkeleton label="选手概览" height="min-h-96" />}>
          <PlayerOverview sections={sections} userId={userId} query={query} fromStats={fromStats} />
        </Suspense>
      )}
      {section === "stats" && (
        <Suspense fallback={<ProfileSectionSkeleton label="竞技表现" height="min-h-96" />}>
          <PlayerPerformance
            sections={sections}
            userId={userId}
            query={query}
            fromStats={fromStats}
          />
        </Suspense>
      )}
      {section === "profile" && (
        <>
          <Suspense fallback={<ProfileSectionSkeleton label="基本资料" height="min-h-40" />}>
            <PlayerBasics sections={sections} />
          </Suspense>
          <Suspense fallback={<ProfileSectionSkeleton label="赛事履历" height="min-h-40" />}>
            <PlayerCareerHistory sections={sections} />
          </Suspense>
          <PlayerDisciplineHistory sanctions={sanctions} />
          <Suspense fallback={<ProfileSectionSkeleton label="个人资料" height="min-h-48" />}>
            <PlayerDeclaredProfile sections={sections} />
          </Suspense>
        </>
      )}
      <Suspense fallback={null}>
        <PlayerProfileReady sections={sections} section={section} />
      </Suspense>
    </PageLayout>
  );
}

type SectionProps = { sections: PublicPlayerProfileSections };

function ProfileSectionSkeleton({ label, height }: { label: string; height: string }) {
  return (
    <div
      aria-busy="true"
      aria-label={`正在加载${label}`}
      className={`${height} animate-pulse border-y border-[var(--color-border)] bg-[var(--color-panel-low)]`}
    />
  );
}

async function PlayerBasics({ sections }: SectionProps) {
  const profile = await sections.basic;
  return (
    <div data-profile-section="basic">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          {profile.publicEducationIdentities.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-fg-mid)]">
              <span className="font-mono text-[var(--color-fg-dim)]">高校身份</span>
              {profile.publicEducationIdentities.map((education) => (
                <span key={education.institutionName}>
                  {education.institutionName} · {education.academicStatus} ·{" "}
                  {education.verificationLabel}
                </span>
              ))}
            </div>
          )}

          {profile.publicCompetitiveRoles.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {profile.publicCompetitiveRoles.map((role) => (
                <PosChip key={role} pos={role} />
              ))}
            </div>
          )}

          <div className="grid gap-3 border-t border-[var(--color-border)] pt-3 text-sm">
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-dim)]">
                当前活动
              </p>
              <div className="space-y-1.5">
                {profile.currentTeams.map((team) => (
                  <TeamProfileLink
                    key={team.slug}
                    className="block font-semibold transition-colors hover:text-[var(--color-accent)]"
                    slug={team.slug}
                  >
                    {team.name} →
                  </TeamProfileLink>
                ))}
                {profile.currentEventTeams.map((entry) => (
                  <TeamProfileLink
                    key={entry.teamId}
                    className="block text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-accent)]"
                    seasonSlug={entry.seasonSlug}
                    entryId={entry.teamId}
                  >
                    {entry.seasonName} · {entry.teamName} →
                  </TeamProfileLink>
                ))}
                {profile.currentTeams.length === 0 && profile.currentEventTeams.length === 0 && (
                  <p className="text-[var(--color-fg-mid)]">暂无当前赛事或队伍</p>
                )}
              </div>
            </div>

            {profile.playerLft && (
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-dim)]">
                  正在找队
                </p>
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {profile.playerLft.positions.map((position) => (
                      <PosChip key={position} pos={position} />
                    ))}
                  </div>
                  {profile.playerLft.targetSeasonName && (
                    <p className="text-[var(--color-fg-mid)]">
                      目标赛事 · {profile.playerLft.targetSeasonName}
                    </p>
                  )}
                  {profile.playerLft.note && (
                    <p className="line-clamp-2 text-[var(--color-fg-mid)]">
                      {profile.playerLft.note}
                    </p>
                  )}
                  <Link
                    href="/teams/recruitment?view=players"
                    className="text-[var(--color-accent)]"
                  >
                    查看组队大厅 →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

async function PlayerCurrentTeams({ sections }: SectionProps) {
  const { currentTeams, currentEventTeams } = await sections.basic;
  if (!currentTeams.length && !currentEventTeams.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--color-fg-mid)]">
      {currentTeams.map((team) => (
        <TeamProfileLink key={team.slug} slug={team.slug}>
          {team.name} →
        </TeamProfileLink>
      ))}
      {currentEventTeams.map((entry) => (
        <TeamProfileLink key={entry.teamId} seasonSlug={entry.seasonSlug} entryId={entry.teamId}>
          {entry.seasonName} · {entry.teamName} →
        </TeamProfileLink>
      ))}
    </div>
  );
}

function validatePlayerScope(
  career: Awaited<PublicPlayerProfileSections["performance"]>["career"],
  userId: string,
  query: ReturnType<typeof parsePlayerPerformanceQuery>,
  section: PlayerProfileSection,
  fromStats: ReturnType<typeof safeStatsReturn>,
) {
  if (!career) return;
  if (query.event && !career.selectedEvent)
    redirect(
      playerProfileHref(userId, { event: "", map: "" }, section, fromStats) as import("next").Route,
    );
  if (query.map && !career.mapFilter)
    redirect(
      playerProfileHref(userId, { ...query, map: "" }, section, fromStats) as import("next").Route,
    );
}

async function PlayerOverview({
  sections,
  userId,
  query,
  fromStats,
}: SectionProps & {
  userId: string;
  query: ReturnType<typeof parsePlayerPerformanceQuery>;
  fromStats: ReturnType<typeof safeStatsReturn>;
}) {
  const { career } = await sections.performance;
  validatePlayerScope(career, userId, query, "overview", fromStats);
  const statsHref = playerProfileHref(userId, query, "stats", fromStats);
  const row = career?.scoreboard[0];
  return (
    <div className="space-y-7" data-profile-section="overview">
      {career ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1 text-xs text-[var(--color-fg-mid)]">
              <p>
                {career.selectedEvent?.name ?? "全生涯"} · {career.mapFilter ?? "全部地图"}
              </p>
              <p>
                {career.summary.matches} 场 · {career.summary.maps} 图 · {career.summary.rounds}{" "}
                回合
              </p>
            </div>
            <PlayerPerformanceFilters
              userId={userId}
              events={career.events}
              query={query}
              fromStats={fromStats}
            />
          </div>
          <dl
            aria-label="核心表现"
            className="grid grid-cols-2 border-y border-[var(--color-border)] sm:grid-cols-4"
          >
            {(
              [
                ["rating", "Rating", row?.avgRating ?? null],
                ["adr", "ADR", row?.avgAdr ?? null],
                ["kd", "K/D", row?.kdRatio ?? null],
                ["maps", "Maps", career.summary.maps],
              ] as const
            ).map(([metric, label, value]) => (
              <div
                key={metric}
                className="border-[var(--color-border)] py-3 odd:pr-4 even:border-l even:pl-4 sm:border-l sm:px-5 sm:first:border-l-0 sm:first:pl-0"
              >
                <dt className="mb-2 text-xs text-[var(--color-fg-mid)]">
                  {metric === "maps" ? (
                    label
                  ) : (
                    <StatsMetricLabel metric={metric}>{label}</StatsMetricLabel>
                  )}
                </dt>
                <dd className="font-mono text-2xl font-semibold tabular-nums">
                  {metric === "maps" ? value : <MetricValue metric={metric} value={value} />}
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p role="status" className="text-sm text-[var(--color-fg-mid)]">
          竞技统计暂时无法加载，请稍后重试。
        </p>
      )}
      <div className="grid min-w-0 items-start gap-8 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <Suspense fallback={<ProfileSectionSkeleton label="打法画像" height="min-h-64" />}>
            <PlayerAttributeSection sections={sections} compact />
          </Suspense>
          <Link
            href={statsHref as import("next").Route}
            className="inline-flex min-h-8 items-center text-sm text-[var(--color-accent)]"
          >
            完整画像与统计 →
          </Link>
        </div>
        <Suspense fallback={<ProfileSectionSkeleton label="近期比赛" height="min-h-64" />}>
          <PlayerRecentMatches userId={userId} fromStats={fromStats} />
        </Suspense>
      </div>
    </div>
  );
}

async function PlayerCareerHistory({ sections }: SectionProps) {
  const [history, basic] = await Promise.all([sections.history, sections.basic]);
  const profile = { ...history, ...basic };
  const registrationBySeasonId = new Map(
    profile.registrationSnapshots.map((registration) => [registration.seasonId, registration]),
  );
  const careerSeasonIds = new Set(profile.careerHistory.map((entry) => entry.seasonId));
  const standaloneRegistrationSnapshots = profile.registrationSnapshots.filter(
    (registration) => !careerSeasonIds.has(registration.seasonId),
  );
  const teamBySeasonId = new Map(profile.eventTeams.map((entry) => [entry.seasonId, entry]));
  const renderRegistrationSnapshot = (
    registration: (typeof profile.registrationSnapshots)[number],
  ) => {
    const teamInfo = teamBySeasonId.get(registration.seasonId);
    const position =
      POSITION_LABELS[registration.primaryPosition as keyof typeof POSITION_LABELS]?.cn ??
      registration.primaryPosition;
    const peak = [
      registration.peakRank + " (" + registration.peakRankSeason + ")",
      "Rating " + registration.peakRating.toFixed(2),
    ];
    if (registration.peakWe != null) peak.push("WE " + registration.peakWe.toFixed(1));

    return (
      <details className="group border-t border-[var(--color-border)] pt-3">
        <summary className="cursor-pointer list-none text-xs text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-fg)]">
          <span className="inline-flex items-center gap-2">
            <span>报名时资料</span>
            <span aria-hidden="true" className="transition-transform group-open:rotate-90">
              ›
            </span>
          </span>
        </summary>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[var(--color-fg-mid)]">
          <PosChip pos={position} />
          <span>{peak.join(" · ")}</span>
          {teamInfo && (
            <TeamProfileLink
              seasonSlug={teamInfo.seasonSlug}
              entryId={teamInfo.teamId}
              className="transition-colors hover:text-[var(--color-accent)]"
            >
              {teamInfo.teamName} ↗
            </TeamProfileLink>
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
    <div data-profile-section="history">
      <section className="space-y-4" aria-labelledby="player-career-heading">
        <div className="space-y-1">
          <SectionHeading>Career</SectionHeading>
          <h2 id="player-career-heading" className="text-xl font-semibold text-[var(--color-fg)]">
            赛事履历
          </h2>
        </div>

        {profile.careerHistory.length > 0 ? (
          <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
            {profile.careerHistory.map((entry) => {
              const registration = registrationBySeasonId.get(entry.seasonId);
              return (
                <article key={entry.seasonId + ":" + entry.teamId} className="py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <TeamProfileLink
                          className="font-semibold transition-colors hover:text-[var(--color-accent)]"
                          seasonSlug={entry.seasonSlug}
                          entryId={entry.teamId}
                        >
                          {entry.seasonName}
                        </TeamProfileLink>
                        <span className="text-sm text-[var(--color-fg-mid)]">{entry.teamName}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-fg-mid)]">
                        {entry.placement && <span>{entry.placement}</span>}
                        <span>
                          {entry.record.played} 场 · {entry.record.wins} 胜 / {entry.record.losses}{" "}
                          负
                        </span>
                        {entry.honors.map((honor) => (
                          <span key={honor}>官方荣誉 · {honor}</span>
                        ))}
                      </div>
                      {entry.honorHistory.length > 0 && (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-fg-dim)]">
                          {entry.honorHistory.map((honor, index) => (
                            <span key={index}>
                              {honor.label} · {HONOR_STATE_LABELS[honor.state]}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <Link
                      href={statsEntryHref(entry.seasonSlug, {
                        tab: "players",
                        teamFilter: entry.teamId,
                      })}
                      className="shrink-0 text-xs text-[var(--color-accent)]"
                    >
                      赛事选手统计 →
                    </Link>
                  </div>
                  {registration && (
                    <div className="mt-4">{renderRegistrationSnapshot(registration)}</div>
                  )}
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
    </div>
  );
}

async function PlayerPerformance({
  sections,
  userId,
  query,
  fromStats,
}: SectionProps & {
  userId: string;
  query: ReturnType<typeof parsePlayerPerformanceQuery>;
  fromStats: ReturnType<typeof safeStatsReturn>;
}) {
  const { career } = await sections.performance;
  validatePlayerScope(career, userId, query, "stats", fromStats);

  return (
    <div data-profile-section="performance">
      {career ? (
        <section className="space-y-4" aria-labelledby="player-performance-heading">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <SectionHeading>Performance</SectionHeading>
              <h2 id="player-performance-heading" className="text-xl font-semibold">
                竞技表现{" "}
                <span className="text-sm font-normal text-[var(--color-fg-mid)]">
                  · {career.selectedEvent?.name ?? "All-time"}
                </span>
              </h2>
            </div>
            <PlayerPerformanceFilters
              userId={userId}
              events={career.events}
              query={query}
              fromStats={fromStats}
              section="stats"
            />
          </div>

          {career.coverage.completedMaps > 0 &&
            career.coverage.detailedMaps < career.coverage.completedMaps && (
              <p className="text-xs text-[var(--color-fg-mid)]">
                详细数据覆盖 {career.coverage.detailedMaps}/{career.coverage.completedMaps} 张地图
              </p>
            )}

          <dl className="grid grid-cols-2 border-y border-[var(--color-border)] sm:grid-cols-4">
            <div className="px-3 py-3 sm:first:pl-0">
              <dt className="text-[11px] text-[var(--color-fg-mid)]">Matches</dt>
              <dd className="mt-1 font-semibold tabular-nums">{career.summary.matches}</dd>
              <p className="text-xs text-[var(--color-fg-dim)]">
                {career.summary.wins}–{career.summary.losses} ·{" "}
                {pct(career.summary.wins, career.summary.matches)}
              </p>
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
              <dd className="mt-1 font-semibold tabular-nums">
                {career.summary.mvp > 0 ? career.summary.mvp : "—"}
              </dd>
            </div>
          </dl>

          <Suspense
            fallback={
              career.performance ? (
                <ProfileSectionSkeleton label="选手属性" height="min-h-64" />
              ) : null
            }
          >
            <PlayerAttributeSection sections={sections} />
          </Suspense>

          <PlayerWorkspace detail={career} compact />
        </section>
      ) : (
        <p role="status" className="text-sm text-[var(--color-fg-mid)]">
          竞技统计暂时无法加载，请稍后重试。
        </p>
      )}
    </div>
  );
}

async function PlayerAttributeSection({
  sections,
  compact = false,
}: SectionProps & { compact?: boolean }) {
  const profile = await sections.attributes();
  if (!profile.attributes && !profile.benchmarkUnavailable)
    return compact ? (
      <p className="py-4 text-sm text-[var(--color-fg-mid)]">当前范围暂无可用画像。</p>
    ) : null;
  return (
    <div data-profile-section="attributes">
      {profile.attributes && <PlayerAttributes profile={profile.attributes} compact={compact} />}
      {profile.benchmarkUnavailable && (
        <p role="status" className="text-sm text-[var(--color-fg-mid)]">
          选手属性暂时无法加载，请稍后重试。
        </p>
      )}
    </div>
  );
}

async function PlayerDeclaredProfile({ sections }: SectionProps) {
  const profile = await sections.basic;
  const { user } = profile;
  const hasDeclaredProfile =
    profile.publicCompetitiveProfile.length > 0 ||
    profile.mapPreferences.length > 0 ||
    Boolean(user.gameplayStyle?.trim() || user.competitionHistory?.trim());

  return (
    <>
      {hasDeclaredProfile && (
        <section className="space-y-4" aria-labelledby="player-profile-heading">
          <div className="space-y-1">
            <SectionHeading>Profile</SectionHeading>
            <h2 id="player-profile-heading" className="text-xl font-semibold">
              长期资料
            </h2>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
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
                          {" · "}
                          {fact.rankLabel}
                          {fact.stars !== null ? " " + fact.stars + " 星" : ""}
                          {fact.ratingLabel && fact.rating !== null
                            ? " · " + fact.ratingLabel + " " + fact.rating
                            : ""}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
              <h3 className="text-sm font-semibold">地图熟练度</h3>
              <MapPreferenceChips
                preferences={profile.mapPreferences}
                minLevel="none"
                showUnfilled
              />
              {profile.mapPreferences.length === 0 && (
                <p className="text-sm text-[var(--color-fg-mid)]">暂无长期地图熟练度资料</p>
              )}
            </div>
          </div>

          {(user.gameplayStyle?.trim() || user.competitionHistory?.trim()) && (
            <div className="space-y-3 border-t border-[var(--color-border)] pt-4">
              <h3 className="text-sm font-semibold">选手自述</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {PUBLIC_PLAYER_INFO_FIELDS.map(({ key, label }) => ({
                  value: user[key]?.trim(),
                  label,
                }))
                  .filter((entry) => entry.value)
                  .map(({ value, label }) => (
                    <div key={label}>
                      <span className="font-mono text-xs font-semibold text-[var(--color-fg-mid)]">
                        {label}
                      </span>
                      <p className="mt-1 text-sm leading-6 text-[var(--color-fg)]">{value}</p>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}

async function PlayerProfileReady({
  sections,
  section,
}: SectionProps & { section: PlayerProfileSection }) {
  await sections.basic;
  if (section === "profile") await sections.history;
  else await Promise.all([sections.performance, sections.attributes()]);
  return <ContentReady module="player" phase="primary" />;
}

function PlayerPageFallback() {
  return (
    <PageLayout variant="standard" className="min-h-[60vh]" aria-busy="true">
      <span className="sr-only">正在加载选手页面…</span>
    </PageLayout>
  );
}

function PlayerIdentity({
  user,
  hasActivePublicSanction,
}: {
  user: PublicPlayer;
  hasActivePublicSanction: boolean;
}) {
  return (
    <header className="flex min-w-0 items-center gap-4 border-b border-[var(--color-border)] pb-6">
      <PlayerAvatar
        name={getPublicDisplayName(user)}
        avatarUrl={user.avatarUrl}
        hasActivePublicSanction={hasActivePublicSanction}
        size="lg"
      />
      <div className="min-w-0 space-y-2">
        <h1 className="break-words text-3xl font-black text-[var(--color-fg)]">
          {getPublicDisplayName(user)}
        </h1>
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
    </header>
  );
}
