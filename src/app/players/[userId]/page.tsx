import { Suspense, type ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { PageLayout, Panel, PosChip } from "@/components/rivalhub";
import { MapPreferenceChips } from "@/components/rivalhub/MapPreferenceChips";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { PlayerPerformanceFilters } from "@/components/players/PlayerPerformanceFilters";
import { PlayerWorkspace } from "@/components/stats/players/PlayerWorkspace";
import { MetricPanel, MetricValue } from "@/components/stats/MetricValue";
import { StatsMetricLabel } from "@/components/stats/StatsMetricHelp";
import { PlayerRadarChart } from "@/components/matches/PlayerRadarChart";
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
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <div className="mb-3 text-[11px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-mid)]">{children}</div>;
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
  const profile = await getPublicPlayerProfileReadModel(userId, { eventSlug: query.event || undefined, mapFilter: query.map || undefined });
  if (!profile) notFound();
  if (query.event && !profile.career.selectedEvent) redirect(`/players/${userId}`);
  if (query.map && !profile.career.mapFilter) redirect(query.event ? `/players/${userId}?event=${encodeURIComponent(query.event)}` : `/players/${userId}`);

  const { user, career } = profile;
  const mvpCount = career.summary.mvp;
  const teamBySeasonId = new Map(profile.eventTeams.map((entry) => [entry.seasonId, entry]));

  return (
    <PageLayout variant="standard" className="space-y-10">
      <div className="flex items-center gap-6">
        <PlayerAvatar name={getPublicDisplayName(user)} avatarUrl={user.avatarUrl} size="lg" />
        <div className="space-y-2">
          <h1 className="text-3xl font-black text-[var(--color-fg)]">{getPublicDisplayName(user)}</h1>
          {user.perfectName && <p className="text-xs font-mono text-[var(--color-fg-dim)]">完美平台：{user.perfectName}</p>}
          {profile.publicEducationIdentities.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-fg-mid)]">
              <span className="font-mono text-[var(--color-fg-dim)]">高校身份</span>
              {profile.publicEducationIdentities.map((education) => <span key={education.institutionName} className="inline-flex items-center rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2 py-1">{education.institutionName} · {education.academicStatus} · {education.verificationLabel}</span>)}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {profile.publicCompetitiveRoles.map((role) => <PosChip key={role} pos={role} />)}
            {user.steamProfileUrl && <a href={user.steamProfileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-accent)]">Steam ↗</a>}
          </div>
        </div>
      </div>

      <Panel label="当前活动">
        <div className="space-y-3">
          {profile.currentTeams.map((team) => <Link key={team.slug} className="block font-semibold" href={`/teams/${team.slug}`}>当前队伍 · {team.name} →</Link>)}
          {profile.currentEventTeams.map((entry) => <Link key={entry.teamId} className="block text-sm" href={`/${entry.seasonSlug}/teams/${entry.teamId}`}>{entry.seasonName} · {entry.teamName} →</Link>)}
          {profile.currentTeams.length === 0 && profile.currentEventTeams.length === 0 && <p className="text-sm text-[var(--color-fg-mid)]">暂无当前赛事或队伍</p>}
        </div>
      </Panel>

      {profile.playerLft && <section className="space-y-3">
        <SectionHeading>正在找队</SectionHeading>
        <Panel contentClassName="p-4">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">{profile.playerLft.positions.map((position) => <PosChip key={position} pos={position} />)}</div>
            {profile.playerLft.targetSeasonName && <p className="text-sm text-[var(--color-fg-mid)]">目标赛事 · {profile.playerLft.targetSeasonName}</p>}
            {profile.playerLft.note && <p className="text-sm leading-6 text-[var(--color-fg-mid)]">{profile.playerLft.note}</p>}
            <Link href="/teams/recruitment?view=players" className="text-sm text-[var(--color-accent)]">查看组队大厅 →</Link>
          </div>
        </Panel>
      </section>}

      <section className="space-y-3">
        <SectionHeading>赛事履历</SectionHeading>
        {profile.careerHistory.length > 0 ? <div className="space-y-2">
          {profile.careerHistory.map((entry) => <Panel key={`${entry.seasonId}:${entry.teamId}`} contentClassName="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <Link className="font-semibold hover:text-[var(--color-accent)]" href={`/${entry.seasonSlug}/teams/${entry.teamId}`}>{entry.seasonName} · {entry.teamName}</Link>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--color-fg-mid)]">
                  {entry.placement && <span>{entry.placement}</span>}
                  <span>{entry.record.played} 场 · {entry.record.wins} 胜 / {entry.record.losses} 负</span>
                  {entry.honors.map((honor) => <span key={honor}>官方荣誉 · {honor}</span>)}
                </div>
              </div>
              <Link href={`/${entry.seasonSlug}/stats?tab=players&teamFilter=${entry.teamId}`} className="shrink-0 text-xs text-[var(--color-accent)]">赛事选手统计 →</Link>
            </div>
          </Panel>)}
        </div> : <p className="text-sm text-[var(--color-fg-mid)]">暂无已结束赛事记录</p>}
      </section>

      {profile.registrationSnapshots.length > 0 ? (
        <section className="space-y-3">
          <SectionHeading>报名档案（报名时资料）</SectionHeading>
          <div className="space-y-2">
            {profile.registrationSnapshots.map((registration) => {
              const teamInfo = teamBySeasonId.get(registration.seasonId);
              const position = POSITION_LABELS[registration.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? registration.primaryPosition;
              const peak = [`${registration.peakRank} (${registration.peakRankSeason})`, `Rating ${registration.peakRating.toFixed(2)}`];
              if (registration.peakWe != null) peak.push(`WE ${registration.peakWe.toFixed(1)}`);
              return <Panel key={registration.id} contentClassName="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--color-fg)]">{registration.seasonName}</span>
                      {teamInfo && <Link href={`/${teamInfo.seasonSlug}/teams/${teamInfo.teamId}`} className="text-xs text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-accent)]">{teamInfo.teamName} ↗</Link>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2"><PosChip pos={position} /><span className="text-xs text-[var(--color-fg-mid)]">{peak.join(" · ")}</span></div>
                  </div>
                  {registration.highlightVideoUrl && <a href={registration.highlightVideoUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-[var(--color-accent)] hover:underline">🎬 高光视频</a>}
                </div>
              </Panel>;
            })}
          </div>
        </section>
      ) : <Panel contentClassName="p-8 text-center"><p className="text-[var(--color-fg-mid)]">暂无个人报名记录</p></Panel>}

      <section className="space-y-3" aria-labelledby="player-performance-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><SectionHeading>Performance</SectionHeading><h2 id="player-performance-heading" className="text-xl font-semibold">{career.selectedEvent?.name ?? "All-time"}</h2></div>
          <PlayerPerformanceFilters userId={userId} events={career.events} query={query} />
        </div>
        {career.coverage.completedMaps > 0 && career.coverage.detailedMaps < career.coverage.completedMaps && <p className="text-xs text-[var(--color-fg-mid)]">详细数据覆盖 {career.coverage.detailedMaps}/{career.coverage.completedMaps} 张地图</p>}
        <MetricPanel title="生涯总览">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-[var(--color-fg-mid)]">正式比赛</p><p className="font-semibold tabular-nums">{career.summary.matches} 场 · {career.summary.wins} 胜 / {career.summary.losses} 负</p><p className="text-xs text-[var(--color-fg-dim)]">胜率 {pct(career.summary.wins, career.summary.matches)}</p></div>
            <div><p className="text-xs text-[var(--color-fg-mid)]">Maps</p><p className="font-semibold tabular-nums">{career.summary.maps}</p></div>
            <div><p className="text-xs text-[var(--color-fg-mid)]">Rounds</p><p className="font-semibold tabular-nums">{career.summary.rounds}</p></div>
            <div><p className="text-xs text-[var(--color-fg-mid)]">单场 MVP</p><p className="font-semibold tabular-nums">{mvpCount > 0 ? mvpCount : "—"}</p></div>
            <div><p className="text-xs text-[var(--color-fg-mid)]"><StatsMetricLabel metric="rating">Rating</StatsMetricLabel></p><MetricValue metric="rating" value={career.scoreboard[0]?.avgRating ?? null} /></div>
            <div><p className="text-xs text-[var(--color-fg-mid)]"><StatsMetricLabel metric="adr">ADR</StatsMetricLabel></p><MetricValue metric="adr" value={career.scoreboard[0]?.avgAdr ?? null} /></div>
            <div><p className="text-xs text-[var(--color-fg-mid)]"><StatsMetricLabel metric="kd">K/D</StatsMetricLabel></p><MetricValue metric="kd" value={career.scoreboard[0]?.kdRatio ?? null} /></div>
            <div><p className="text-xs text-[var(--color-fg-mid)]"><StatsMetricLabel metric="kpr">KPR</StatsMetricLabel></p><MetricValue metric="kpr" value={career.scoreboard[0]?.kpr ?? null} /></div>
          </div>
        </MetricPanel>
        <PlayerWorkspace detail={career} compact />
      </section>

      {profile.radar && career.selectedEvent && <section className="space-y-3">
        <SectionHeading>{career.selectedEvent.name} 竞技轮廓</SectionHeading>
        <Panel contentClassName="p-4">
          <PlayerRadarChart players={[{ name: getPublicDisplayName(user), scores: profile.radar, color: "var(--color-accent)" }]} size={280} />
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-fg-dim)]">六维评分按单届赛事内的选手数据标准化，仅用于该赛事内比较。</p>
        </Panel>
      </section>}

      {profile.publicCompetitiveProfile.length > 0 && <section className="space-y-3">
        <SectionHeading>公开竞技档案</SectionHeading>
        <Panel contentClassName="p-4"><div className="space-y-4 text-sm">{profile.publicCompetitiveProfile.map((platform) => <div key={platform.displayName} className="space-y-2"><p className="font-semibold text-[var(--color-fg)]">{platform.displayName}</p>{platform.facts.map((fact) => <p key={`${platform.displayName}-${fact.label}`}><span className="text-[var(--color-fg-mid)]">{fact.label}</span> · {fact.rankLabel}{fact.stars !== null ? ` ${fact.stars} 星` : ""}{fact.ratingLabel && fact.rating !== null ? ` · ${fact.ratingLabel} ${fact.rating}` : ""}</p>)}</div>)}</div></Panel>
      </section>}

      <section className="space-y-3">
        <SectionHeading>自报地图熟练度</SectionHeading>
        <Panel><MapPreferenceChips preferences={profile.mapPreferences} minLevel="none" showUnfilled /></Panel>
      </section>

      {(user.gameplayStyle?.trim() || user.competitionHistory?.trim()) && <section className="space-y-3">
        <SectionHeading>选手自述</SectionHeading>
        <Panel contentClassName="p-4"><div className="space-y-2">
          {PUBLIC_PLAYER_INFO_FIELDS.map(({ key, label }) => ({ value: user[key]?.trim(), label })).filter((entry) => entry.value).map(({ value, label }) => <div key={label}><span className="font-mono text-xs font-semibold text-[var(--color-fg-mid)]">{label}</span><p className="mt-0.5 text-sm text-[var(--color-fg)]">{value}</p></div>)}
        </div></Panel>
      </section>}
    </PageLayout>
  );
}

function PlayerPageFallback() {
  return <PageLayout variant="standard" className="min-h-[60vh]" aria-busy="true"><span className="sr-only">正在加载选手页面…</span></PageLayout>;
}
