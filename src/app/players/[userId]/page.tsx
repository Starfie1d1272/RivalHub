import { getPublicPlayerRecord } from "@/lib/players/public-record";
import { getPublicPlayerMapExperience } from "@/lib/stats/public-query";
import { mapLabel } from "@/lib/maps";
import { publicCompetitionEntryCondition } from "@/lib/competition-entries/public-visibility";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { eq, and, asc, desc, max, sql, ne, isNull, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { teamMemberships, teams, competitionEntries, educationVerifications, eventRosterMembers, eventRosters, institutions, seasonRegistrations, seasons, matches, matchMaps, competitiveRankFacts, userCompetitiveRoles, userMapPreferences } from "@/db/schema";
import { getPublicPlayerById } from "@/lib/data/public-players";
import { PUBLIC_PLAYER_INFO_FIELDS } from "@/lib/utils/player-info-fields";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { PageLayout, Panel, Stat, PosChip } from "@/components/rivalhub";
import { MapPreferenceChips } from "@/components/rivalhub/MapPreferenceChips";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import Link from "next/link";
import { POSITION_LABELS } from "@/lib/validators/registration";
import { matchPlayerStats, type MatchPlayerStat } from "@/db/schema/player-stats";
import { avgNums } from "@/lib/utils/stats";
import { aggregatePlayerRows, formatNumber, formatStat, type AggregatedPlayerStats, type StatRowInput } from "@/lib/stats";
import { getSeasonHexagonScores } from "@/actions/hexagon";
import type { HexagonScores } from "@/lib/utils/hexagon";
import { PlayerRadarChart } from "@/components/matches/PlayerRadarChart";
import { loadCompetitivePlatformCatalog } from "@/lib/competitive/catalog";
import { presentCompetitiveRole, presentPublicCompetitiveProfile } from "@/lib/competitive/presentation";
import { presentPublicEducationIdentities } from "@/lib/education/presentation";
import { getPublicPlayerLft } from "@/lib/recruitment/data";
import { resolveCanonicalUserId } from "@/lib/identity/canonical";

/**
 * 统计玩家 MVP 获胜次数（从 matches.mvp_winner_user_id 直读，已持久化缓存）。
 */
async function getMvpWinCount(userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(matches)
    .where(eq(matches.mvpWinnerUserId, userId));
  return rows[0]?.count ?? 0;
}

interface PlayerPageProps {
  params: Promise<{ userId: string }>;
}

type PlayerStatRow = Pick<
  MatchPlayerStat,
  | "mapId"
  | "userId"
  | "perfectName"
  | "kills"
  | "deaths"
  | "assists"
  | "hsPercent"
  | "firstKills"
  | "multiKills"
  | "clutches"
  | "adr"
  | "rws"
  | "ratingPro"
  | "we"
 > & {
  seasonId: string;
  seasonName: string;
  seasonSlug: string;
  seasonCompletedAt: Date | null;
  rounds: number | null;
};

type PlayerSeasonStats = AggregatedPlayerStats & {
  seasonId: string;
  seasonName: string;
  seasonSlug: string;
  seasonCompletedAt: Date | null;
  avgKills: number | null;
  avgDeaths: number | null;
  avgAssists: number | null;
};

function toStatInput(row: PlayerStatRow): StatRowInput {
  return {
    userId: row.userId,
    perfectName: row.perfectName,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    hsPercent: row.hsPercent,
    firstKills: row.firstKills,
    multiKills: row.multiKills,
    clutches: row.clutches,
    adr: row.adr,
    rws: row.rws,
    ratingPro: row.ratingPro,
    we: row.we,
    rounds: row.rounds,
  };
}

function aggregateSeasonRows(rows: PlayerStatRow[]): PlayerSeasonStats {
  const aggregate = aggregatePlayerRows(rows.map(toStatInput));
  return {
    ...aggregate,
    seasonId: rows[0].seasonId,
    seasonName: rows[0].seasonName,
    seasonSlug: rows[0].seasonSlug,
    seasonCompletedAt: rows.reduce<Date | null>((latest, row) => !latest || (row.seasonCompletedAt && row.seasonCompletedAt > latest) ? row.seasonCompletedAt : latest, null),
    avgKills: avgNums(rows.map((row) => row.kills)),
    avgDeaths: avgNums(rows.map((row) => row.deaths)),
    avgAssists: avgNums(rows.map((row) => row.assists)),
  };
}

function pct(n: number, d: number) {
  if (d === 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-fg-mid)", letterSpacing: "var(--tracking-label)", textTransform: "uppercase", marginBottom: 12 }}>
      {children}
    </div>
  );
}

export default function PlayerPage({ params }: PlayerPageProps) {
  return (
    <Suspense fallback={<PlayerPageFallback />}>
      <PlayerPageContent params={params} />
    </Suspense>
  );
}

export async function PlayerPageContent({ params }: PlayerPageProps) {
  await connection();
  const { userId } = await params;
  const canonicalUserId = await resolveCanonicalUserId(db, userId);
  if (!canonicalUserId) notFound();
  if (canonicalUserId !== userId) redirect(`/players/${canonicalUserId}`);

  const [mapExperience, currentTeams] = await Promise.all([
    getPublicPlayerMapExperience([userId]),
    db.select({ slug: teams.slug, name: teams.name }).from(teamMemberships).innerJoin(teams, eq(teams.id, teamMemberships.teamId)).where(and(eq(teamMemberships.userId, userId), isNull(teamMemberships.endedAt), eq(teams.status, "active"))),
  ]);
  const user = await getPublicPlayerById(userId);
  if (!user) notFound();

  // ── 并行：报名记录 / MVP 胜场 / 个人数据 / 高校身份 ────────────────
  const [registrations, mvpWinCount, rawPlayerStats, competitiveFacts, competitiveRoles, mapPreferences, competitiveCatalog, educationVerificationRows, playerLft] = await Promise.all([
    db
      .select({
        id: seasonRegistrations.id,
        seasonId: seasonRegistrations.seasonId,
        primaryPosition: seasonRegistrations.primaryPosition,
        peakRank: seasonRegistrations.peakRank,
        peakRankSeason: seasonRegistrations.peakRankSeason,
        peakRating: seasonRegistrations.peakRating,
        peakWe: seasonRegistrations.peakWe,
        mapPreferences: seasonRegistrations.mapPreferences,
        highlightVideoUrl: seasonRegistrations.highlightVideoUrl,
        status: seasonRegistrations.status,
        seasonName: seasons.name,
        seasonSlug: seasons.slug,
      })
      .from(seasonRegistrations)
      .innerJoin(seasons, eq(seasonRegistrations.seasonId, seasons.id))
      .where(
        and(
          eq(seasonRegistrations.userId, userId),
          eq(seasonRegistrations.status, "approved"),
          ne(seasons.status, "draft"),
        )
      )
      .orderBy(asc(seasons.name), asc(seasonRegistrations.id)),
    getMvpWinCount(userId),
    db
      .select({
        mapId: matchPlayerStats.mapId,
        userId: matchPlayerStats.userId,
        perfectName: matchPlayerStats.perfectName,
        kills: matchPlayerStats.kills,
        deaths: matchPlayerStats.deaths,
        assists: matchPlayerStats.assists,
        hsPercent: matchPlayerStats.hsPercent,
        firstKills: matchPlayerStats.firstKills,
        multiKills: matchPlayerStats.multiKills,
        clutches: matchPlayerStats.clutches,
        adr: matchPlayerStats.adr,
        rws: matchPlayerStats.rws,
        ratingPro: matchPlayerStats.ratingPro,
        we: matchPlayerStats.we,
        seasonId: seasons.id,
        seasonName: seasons.name,
        seasonSlug: seasons.slug,
        seasonCompletedAt: matches.completedAt,
        rounds: sql<number | null>`${matchMaps.scoreA} + ${matchMaps.scoreB}`,
      })
      .from(matchPlayerStats)
      .innerJoin(matches, eq(matchPlayerStats.matchId, matches.id))
      .innerJoin(matchMaps, eq(matchPlayerStats.mapId, matchMaps.id))
      .innerJoin(seasons, eq(matches.seasonId, seasons.id))
      .where(
        and(
          eq(matchPlayerStats.userId, userId),
          eq(matches.status, "finished"),
          ne(seasons.status, "draft"),
          sql`${matchPlayerStats.verifiedByAdmin} IS NOT NULL`,
        )
      )
      .orderBy(asc(matches.completedAt), asc(seasons.name)),
    db.select().from(competitiveRankFacts).where(eq(competitiveRankFacts.userId, userId)),
    db.select().from(userCompetitiveRoles).where(eq(userCompetitiveRoles.userId, userId)),
    db.select().from(userMapPreferences).where(eq(userMapPreferences.userId, userId)),
    loadCompetitivePlatformCatalog(db),
    db
      .select({
        id: educationVerifications.id,
        institutionId: educationVerifications.institutionId,
        institutionName: institutions.name,
        academicStatus: educationVerifications.academicStatus,
        status: educationVerifications.status,
        submittedAt: educationVerifications.submittedAt,
      })
      .from(educationVerifications)
      .innerJoin(institutions, eq(educationVerifications.institutionId, institutions.id))
      .where(and(eq(educationVerifications.userId, userId), eq(educationVerifications.status, "approved")))
      .orderBy(asc(institutions.name), asc(educationVerifications.institutionId), desc(educationVerifications.submittedAt), asc(educationVerifications.id)),
    getPublicPlayerLft(userId),
  ]);

  const rowsBySeason = new Map<string, PlayerStatRow[]>();
  for (const row of rawPlayerStats) {
    const seasonRows = rowsBySeason.get(row.seasonId) ?? [];
    seasonRows.push(row);
    rowsBySeason.set(row.seasonId, seasonRows);
  }
  const playerStats = [...rowsBySeason.values()]
    .map(aggregateSeasonRows)
    .sort((a, b) => (a.seasonCompletedAt?.getTime() ?? -Infinity) - (b.seasonCompletedAt?.getTime() ?? -Infinity) || a.seasonName.localeCompare(b.seasonName));
  const careerStats = rawPlayerStats.length > 0
    ? aggregatePlayerRows(rawPlayerStats.map(toStatInput))
    : null;

  const registrationCompletionRows = registrations.length > 0
    ? await db
      .select({ seasonId: matches.seasonId, lastCompletedAt: max(matches.completedAt) })
      .from(matches)
      .where(and(inArray(matches.seasonId, [...new Set(registrations.map((registration) => registration.seasonId))]), eq(matches.status, "finished")))
      .groupBy(matches.seasonId)
    : [];
  const registrationCompletionBySeasonId = new Map(
    registrationCompletionRows.map((row) => [row.seasonId, row.lastCompletedAt]),
  );
  const registrationSnapshots = [...registrations].sort((a, b) => {
    const aCompletedAt = registrationCompletionBySeasonId.get(a.seasonId)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const bCompletedAt = registrationCompletionBySeasonId.get(b.seasonId)?.getTime() ?? Number.NEGATIVE_INFINITY;
    return bCompletedAt - aCompletedAt || a.seasonName.localeCompare(b.seasonName) || a.id.localeCompare(b.id);
  });

  // ── 六维数据：仅对有数据的赛季查询 ──────────────────────────────────
  const hexagonBySeasonSlug = new Map<string, HexagonScores>();
  await Promise.all(
    playerStats.map(async (ps) => {
      const m = await getSeasonHexagonScores(ps.seasonId);
      const s = m.get(userId);
      if (s) hexagonBySeasonSlug.set(ps.seasonSlug, s);
    })
  );

  // ── 队伍归属（canonical userId → team）────────────────────────────────
  const teamMemberRows = await db
    .select({
      seasonId: competitionEntries.competitionId,
      teamId: competitionEntries.id,
      teamName: competitionEntries.name,
      seasonSlug: seasons.slug,
      seasonName: seasons.name,
      seasonStatus: seasons.status,
    })
    .from(eventRosterMembers)
    .innerJoin(eventRosters, eq(eventRosterMembers.eventRosterId, eventRosters.id))
    .innerJoin(competitionEntries, eq(eventRosters.entryId, competitionEntries.id))
    .innerJoin(seasons, eq(competitionEntries.competitionId, seasons.id))
    .where(and(eq(eventRosterMembers.userId, userId), inArray(eventRosters.status, ["confirmed", "frozen"]), ne(seasons.status, "draft"), publicCompetitionEntryCondition()));

  const teamBySeasonId = new Map(teamMemberRows.map((r) => [r.seasonId, r]));
  const publicCompetitiveProfile = presentPublicCompetitiveProfile(competitiveCatalog, competitiveFacts);
  const publicCompetitiveRoles = competitiveRoles
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
    .map((role) => presentCompetitiveRole(role.role))
    .filter((role): role is string => role !== null);
  const publicEducationIdentities = presentPublicEducationIdentities(educationVerificationRows);

  const { wins: totalWins, losses: totalLosses, played } = await getPublicPlayerRecord(userId);

  // Registration snapshots remain event history only; current profile facts
  // come from the long-lived users owner exposed by the public DTO.
  const effectiveMapPrefs = mapPreferences[0]?.mapPreferences ?? [];

  // ── 生涯总计预计算 ──────────────────────────────────────────────────
  const historicalTeamMemberRows = teamMemberRows.filter((entry) => ["finished", "archived"].includes(entry.seasonStatus));
  const currentEventTeamMemberRows = teamMemberRows.filter((entry) => !["finished", "archived"].includes(entry.seasonStatus));
  const totalMaps = careerStats?.maps ?? 0;
  const mvpCount = mvpWinCount;

  return (
    <PageLayout variant="narrow" className="space-y-10">

      {/* 头像 + 基本信息 */}
      <div className="flex items-center gap-6">
        <PlayerAvatar name={getPublicDisplayName(user)} avatarUrl={user.avatarUrl} size="lg" />

        <div className="space-y-2">
          <h1 className="text-3xl font-black text-[var(--color-fg)]">
            {getPublicDisplayName(user)}
          </h1>
          {user.perfectName && (
            <p className="text-xs" style={{ fontFamily: "var(--font-mono)", color: "var(--color-fg-dim)" }}>
              完美平台：{user.perfectName}
            </p>
          )}

          {publicEducationIdentities.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-fg-mid)]">
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-fg-dim)" }}>高校身份</span>
              {publicEducationIdentities.map((education) => (
                <span
                  key={education.institutionName}
                  className="inline-flex items-center rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2 py-1"
                >
                  {education.institutionName} · {education.academicStatus} · {education.verificationLabel}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {publicCompetitiveRoles.map((role) => <PosChip key={role} pos={role} />)}
            {user.steamProfileUrl && (
              <a
                href={user.steamProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--color-fg-mid)] hover:text-[var(--color-accent)] transition-colors"
              >
                Steam ↗
              </a>
            )}
          </div>
        </div>
      </div>

      <Panel label="当前活动"><div className="space-y-3">{currentTeams.map((team) => <Link key={team.slug} className="block font-semibold" href={`/teams/${team.slug}`}>当前队伍 · {team.name} →</Link>)}{currentEventTeamMemberRows.map((entry) => <Link key={entry.teamId} className="block text-sm" href={`/${entry.seasonSlug}/teams/${entry.teamId}`}>{entry.seasonName} · {entry.teamName} →</Link>)}{currentTeams.length === 0 && currentEventTeamMemberRows.length === 0 && <p className="text-sm text-[var(--color-fg-mid)]">暂无当前赛事或队伍</p>}</div></Panel>
      {playerLft && <section className="space-y-3"><SectionHeading>正在找队</SectionHeading><Panel contentClassName="p-4"><div className="space-y-3"><div className="flex flex-wrap gap-2">{playerLft.positions.map((position) => <PosChip key={position} pos={position} />)}</div>{playerLft.targetSeasonName && <p className="text-sm text-[var(--color-fg-mid)]">目标赛事 · {playerLft.targetSeasonName}</p>}{playerLft.note && <p className="text-sm leading-6 text-[var(--color-fg-mid)]">{playerLft.note}</p>}<Link href="/teams/recruitment?view=players" className="text-sm text-[var(--color-accent)]">查看组队大厅 →</Link></div></Panel></section>}

      <section className="space-y-3"><SectionHeading>赛事履历</SectionHeading>{historicalTeamMemberRows.length > 0 ? historicalTeamMemberRows.map((entry) => <Link key={entry.teamId} className="block text-sm" href={`/${entry.seasonSlug}/teams/${entry.teamId}`}>{entry.seasonName} · {entry.teamName} →</Link>) : <p className="text-sm text-[var(--color-fg-mid)]">暂无已结束赛事记录</p>}</section>
      {/* Immutable event-registration snapshots, deliberately separate from the long-lived profile above. */}
      {registrations.length > 0 && (
        <section className="space-y-3">
          <SectionHeading>报名档案（报名时资料）</SectionHeading>
          <div className="space-y-2">
            {registrationSnapshots.map((reg) => {
              const teamInfo = teamBySeasonId.get(reg.seasonId);
              const posLabel = POSITION_LABELS[reg.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? reg.primaryPosition;
              const peakParts = [`${reg.peakRank} (${reg.peakRankSeason})`, `Rating ${reg.peakRating.toFixed(2)}`];
              if (reg.peakWe != null) peakParts.push(`WE ${reg.peakWe.toFixed(1)}`);
              return (
                <Panel key={reg.id} contentClassName="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-[var(--color-fg)]">{reg.seasonName}</span>
                        {teamInfo && (
                          <Link
                            href={`/${teamInfo.seasonSlug}/teams/${teamInfo.teamId}`}
                            className="text-xs text-[var(--color-fg-mid)] hover:text-[var(--color-accent)] transition-colors"
                          >
                            {teamInfo.teamName} ↗
                          </Link>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <PosChip pos={posLabel} />
                        <span className="text-xs text-[var(--color-fg-mid)]">
                          {peakParts.join(" · ")}
                        </span>
                      </div>
                    </div>
                    {reg.highlightVideoUrl && (
                      <a
                        href={reg.highlightVideoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[var(--color-accent)] hover:underline shrink-0"
                      >
                        🎬 高光视频
                      </a>
                    )}
                  </div>
                </Panel>
              );
            })}
          </div>
        </section>
      )}

      {registrations.length === 0 && (
        <Panel contentClassName="p-8 text-center">
          <p className="text-[var(--color-fg-mid)]">暂无个人报名记录</p>
        </Panel>
      )}
      {/* 正式出场战绩 */}
      {played > 0 && (
        <section className="space-y-3">
          <SectionHeading>正式出场战绩</SectionHeading>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            <Stat label="出场" value={played} />
            <Stat label="胜" value={totalWins} />
            <Stat label="负" value={totalLosses} />
            <Stat label="胜率" value={pct(totalWins, played)} />
            <Stat label="单场MVP" value={mvpCount > 0 ? mvpCount : "—"} />
          </div>
        </section>
      )}

      {/* 个人数据 */}
      {playerStats.length > 0 && (
        <section className="space-y-3">
            <SectionHeading>个人数据</SectionHeading>

          {/* 生涯总计 */}
          <Panel label="生涯总计">
            <span className="text-xs text-[var(--color-fg-mid)]">
              {totalMaps} 图
            </span>
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-3 text-center mt-3">
              {[
                { label: "Rating", value: formatStat("ratingPro", careerStats?.ratingPro) },
                { label: "ADR", value: formatStat("adr", careerStats?.adr) },
                { label: "RWS", value: formatStat("rws", careerStats?.rws) },
                { label: "K/D", value: formatStat("kd", careerStats?.kd) },
                { label: "WE", value: formatStat("we", careerStats?.we) },
                { label: "KPR", value: formatStat("kpr", careerStats?.kpr) },
                { label: "FKPR /100r", value: formatStat("fkpr", careerStats?.fkpr) },
                { label: "MKPR /100r", value: formatStat("mkpr", careerStats?.mkpr) },
                { label: "CPR /100r", value: formatStat("cpr", careerStats?.cpr) },
                { label: "HS%", value: formatStat("hsPercent", careerStats?.hsPercent) },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-lg font-bold text-[var(--color-fg)]">
                    {value}
                  </p>
                  <p className="text-[10px] text-[var(--color-fg-dim)] mt-0.5">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </Panel>

          {/* 按赛季分组 */}
          {[...playerStats].reverse().map((ps) => (
            <Panel key={ps.seasonSlug} contentClassName="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Link
                  href={`/${ps.seasonSlug}/stats`}
                  className="text-sm font-semibold text-[var(--color-fg)] hover:text-[var(--color-accent)] transition-colors"
                >
                  {ps.seasonName}
                </Link>
                <span className="text-[11px] text-[var(--color-fg-dim)]">
                  {ps.maps} 图 · 场均 {formatNumber(ps.avgKills, 1)}-{formatNumber(ps.avgDeaths, 1)}-{formatNumber(ps.avgAssists, 1)}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-fg-mid)]">
                <span>
                  Rating{" "}
                  <span className="text-[var(--color-accent)] font-semibold">
                    {formatStat("ratingPro", ps.ratingPro)}
                  </span>
                </span>
                <span>
                  ADR{" "}
                  <span className="text-[var(--color-fg)]">{formatStat("adr", ps.adr)}</span>
                </span>
                <span>
                  RWS{" "}
                  <span className="text-[var(--color-fg)]">{formatStat("rws", ps.rws)}</span>
                </span>
                <span>
                  K/D{" "}
                  <span className="text-[var(--color-fg)]">
                    {formatStat("kd", ps.kd)}
                  </span>
                </span>
                <span>
                  WE{" "}
                  <span className="text-[var(--color-fg)]">{formatStat("we", ps.we)}</span>
                </span>
                <span>
                  HS{" "}
                  <span className="text-[var(--color-fg)]">{formatStat("hsPercent", ps.hsPercent)}</span>
                </span>
              </div>
            </Panel>
          ))}

          {/* 竞技轮廓 */}
          {hexagonBySeasonSlug.size > 0 && (
            <div className="space-y-3 mt-4">
              <SectionHeading>竞技轮廓</SectionHeading>
              {[...playerStats].reverse().map((ps) => {
                const scores = hexagonBySeasonSlug.get(ps.seasonSlug);
                if (!scores) return null;
                return (
                  <Panel key={ps.seasonSlug} contentClassName="p-4">
                    <div className="text-xs font-semibold text-[var(--color-fg-mid)] mb-3">
                      {ps.seasonName}
                    </div>
                    <PlayerRadarChart
                      players={[{ name: getPublicDisplayName(user), scores, color: "var(--color-accent)" }]}
                      size={280}
                    />
                  </Panel>
                );
              })}
              <p className="text-[11px] text-[var(--color-fg-dim)] px-1 leading-relaxed">
                六维评分在本赛事内标准化，适合同一赛事内横向比较，不建议跨赛事直接对比。
              </p>
            </div>
          )}
        </section>
      )}

      {mapExperience.length > 0 && <Panel label="正式赛事地图表现"><div className="grid gap-4 sm:grid-cols-2">{mapExperience.map((map) => <div key={map.mapName}><h2 className="font-semibold">{mapLabel(map.mapName)}</h2><p className="text-xs text-[var(--color-fg-mid)]">{map.samples} 图 · Rating {formatStat("ratingPro", map.rating)} · ADR {formatStat("adr", map.adr)} · K/D {formatStat("kd", map.kd)}</p></div>)}</div></Panel>}
      {publicCompetitiveProfile.length > 0 && <section className="space-y-3"><SectionHeading>公开竞技档案</SectionHeading><Panel contentClassName="p-4"><div className="space-y-4 text-sm">{publicCompetitiveProfile.map((platform) => <div key={platform.displayName} className="space-y-2"><p className="font-semibold text-[var(--color-fg)]">{platform.displayName}</p>{platform.facts.map((fact) => <p key={`${platform.displayName}-${fact.label}`}><span className="text-[var(--color-fg-mid)]">{fact.label}</span> · {fact.rankLabel}{fact.stars !== null ? ` ${fact.stars} 星` : ""}{fact.ratingLabel && fact.rating !== null ? ` · ${fact.ratingLabel} ${fact.rating}` : ""}</p>)}</div>)}</div></Panel></section>}

      <section className="space-y-3">
        <SectionHeading>自报地图熟练度</SectionHeading>
        <Panel>
          <MapPreferenceChips preferences={effectiveMapPrefs} minLevel="none" showUnfilled />
        </Panel>
      </section>

      {/* 选手自述 */}
      {(user.gameplayStyle?.trim() || user.competitionHistory?.trim()) && (
          <section className="space-y-3">
            <SectionHeading>选手自述</SectionHeading>
            <Panel contentClassName="p-4">
              <div className="space-y-2">
                {PUBLIC_PLAYER_INFO_FIELDS
                  .map(({ key, label }) => {
                    const value = user[key];
                    return { value: value?.trim(), label };
                  })
                  .filter((s) => s.value)
                  .map(({ value, label }) => (
                    <div key={label}>
                      <span
                        className="text-xs font-semibold"
                        style={{
                          fontFamily: "var(--font-mono)",
                          color: "var(--color-fg-mid)",
                        }}
                      >
                        {label}
                      </span>
                      <p className="text-sm text-[var(--color-fg)] mt-0.5">
                        {value}
                      </p>
                    </div>
                  ))}
              </div>
            </Panel>
          </section>
        )}

    </PageLayout>
  );
}

function PlayerPageFallback() {
  return (
    <PageLayout variant="narrow" className="min-h-[60vh]" aria-busy="true">
      <span className="sr-only">正在加载选手页面…</span>
    </PageLayout>
  );
}
