import { buildPlayerSeasonProfile } from "@cs2dak/presentation";
import { and, asc, eq, inArray } from "drizzle-orm";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentSeasonAnalysis } from "@/actions/dak-analysis";
import { MapPreferenceChips } from "@/components/rivalhub/MapPreferenceChips";
import { Panel, PosChip, Stat } from "@/components/rivalhub";
import { db } from "@/db/client";
import { seasonRegistrations, seasons, teamMembers, teams, users } from "@/db/schema";
import { resolveAvatarUrl } from "@/lib/steam";
import { getDisplayName } from "@/lib/utils/display-name";
import { PLAYER_INFO_FIELDS } from "@/lib/utils/player-info-fields";
import { POSITION_LABELS } from "@/lib/validators/registration";

interface PlayerPageProps {
  params: Promise<{ userId: string }>;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs uppercase tracking-wide text-[var(--color-fg-mid)]" style={{ fontFamily: "var(--font-mono)" }}>
      {children}
    </h2>
  );
}

function value(metric: number | null | undefined, digits = 2, suffix = "") {
  return metric == null ? "—" : `${metric.toFixed(digits)}${suffix}`;
}

export default async function PlayerPage({ params }: PlayerPageProps) {
  const { userId } = await params;
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) notFound();

  const [registrations, avatarUrl] = await Promise.all([
    db
      .select({
        id: seasonRegistrations.id,
        seasonId: seasonRegistrations.seasonId,
        primaryPosition: seasonRegistrations.primaryPosition,
        secondaryPosition: seasonRegistrations.secondaryPosition,
        peakRank: seasonRegistrations.peakRank,
        peakRankSeason: seasonRegistrations.peakRankSeason,
        peakRating: seasonRegistrations.peakRating,
        peakWe: seasonRegistrations.peakWe,
        currentSeasonPeakRank: seasonRegistrations.currentSeasonPeakRank,
        currentRating: seasonRegistrations.currentRating,
        mapPreferences: seasonRegistrations.mapPreferences,
        highlightVideoUrl: seasonRegistrations.highlightVideoUrl,
        gameplayStyle: seasonRegistrations.gameplayStyle,
        notes: seasonRegistrations.notes,
        competitionHistory: seasonRegistrations.competitionHistory,
        seasonName: seasons.name,
        seasonSlug: seasons.slug,
      })
      .from(seasonRegistrations)
      .innerJoin(seasons, eq(seasonRegistrations.seasonId, seasons.id))
      .where(and(eq(seasonRegistrations.userId, userId), eq(seasonRegistrations.status, "approved")))
      .orderBy(asc(seasons.createdAt)),
    resolveAvatarUrl({ avatarUrl: user.avatarUrl, steam64: user.steam64 }),
  ]);

  const teamRows = registrations.length
    ? await db
        .select({
          registrationId: teamMembers.registrationId,
          teamId: teams.id,
          teamName: teams.name,
          seasonSlug: seasons.slug,
        })
        .from(teamMembers)
        .innerJoin(teams, eq(teamMembers.teamId, teams.id))
        .innerJoin(seasons, eq(teams.seasonId, seasons.id))
        .where(inArray(teamMembers.registrationId, registrations.map((registration) => registration.id)))
    : [];
  const teamByRegistration = new Map(teamRows.map((row) => [row.registrationId, row]));

  const profiles = (
    await Promise.all(registrations.map(async (registration) => {
      const result = await getCurrentSeasonAnalysis(registration.seasonId);
      if (!result.success || !result.data) return null;
      const playerKey = `user:${userId}`;
      if (!result.data.cohort.players.some((player) => player.playerKey === playerKey)) return null;
      return {
        registration,
        profile: buildPlayerSeasonProfile(result.data.cohort, playerKey),
      };
    }))
  ).filter((entry) => entry !== null);

  const latestRegistration = registrations.at(-1);
  const latestProfile = profiles.at(-1)?.profile;
  const displayName = getDisplayName(user);

  return (
    <div className="container mx-auto max-w-4xl space-y-10 px-4 py-12">
      <div className="flex items-center gap-6">
        {avatarUrl ? (
          <Image src={avatarUrl} alt={displayName} width={96} height={96} className="rounded-full border border-[var(--color-border)] object-cover" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-panel-hi)] text-2xl font-bold text-[var(--color-fg-mid)]">
            {displayName.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="space-y-2">
          <h1 className="text-3xl font-black text-[var(--color-fg)]">{displayName}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {latestRegistration && (
              <>
                <PosChip pos={POSITION_LABELS[latestRegistration.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? latestRegistration.primaryPosition} />
                {latestRegistration.secondaryPosition && (
                  <PosChip pos={POSITION_LABELS[latestRegistration.secondaryPosition as keyof typeof POSITION_LABELS]?.cn ?? latestRegistration.secondaryPosition} />
                )}
              </>
            )}
            {user.steamProfileUrl && <a href={user.steamProfileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--color-accent)]">Steam ↗</a>}
          </div>
        </div>
      </div>

      {latestProfile && (
        <section className="space-y-3">
          <SectionHeading>DAK 生涯概览</SectionHeading>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="MAPS" value={latestProfile.mapCount} />
            <Stat label="RR" value={value(latestProfile.rating.rivalhubRR)} accent />
            <Stat label="RATING 2.0" value={value(latestProfile.rating.hltvRating)} />
            <Stat label="ADR" value={value(latestProfile.metrics.adr, 1)} />
            <Stat label="K/D" value={value(latestProfile.metrics.kd)} />
          </div>
        </section>
      )}

      {latestRegistration && (
        <section className="space-y-3">
          <SectionHeading>地图偏好与自述</SectionHeading>
          <Panel>
            <MapPreferenceChips preferences={latestRegistration.mapPreferences ?? []} minLevel="basic" />
            <div className="mt-4 space-y-3">
              {PLAYER_INFO_FIELDS.map(({ key, label }) => ({
                label,
                text: String(latestRegistration[key as keyof typeof latestRegistration] ?? "").trim(),
              })).filter((item) => item.text).map((item) => (
                <div key={item.label}>
                  <p className="text-xs font-semibold text-[var(--color-fg-mid)]">{item.label}</p>
                  <p className="mt-1 text-sm text-[var(--color-fg)]">{item.text}</p>
                </div>
              ))}
            </div>
          </Panel>
        </section>
      )}

      {profiles.length > 0 && (
        <section className="space-y-3">
          <SectionHeading>赛季分析</SectionHeading>
          {[...profiles].reverse().map(({ registration, profile }) => {
            const team = teamByRegistration.get(registration.id);
            return (
              <Panel key={registration.id} label={registration.seasonName} pad={16}>
                <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-fg-mid)]">
                  <Link href={`/${registration.seasonSlug}/stats`} className="font-semibold text-[var(--color-accent)]">赛季榜单 ↗</Link>
                  {team && <Link href={`/${team.seasonSlug}/teams/${team.teamId}`} className="hover:text-[var(--color-accent)]">{team.teamName} ↗</Link>}
                  <span>{profile.mapCount} maps</span>
                  <span>Confidence {value(profile.confidence * 100, 0, "%")}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6">
                  <Stat label="RR" value={value(profile.rating.rivalhubRR)} accent />
                  <Stat label="RATING 2.0" value={value(profile.rating.hltvRating)} />
                  <Stat label="ADR" value={value(profile.metrics.adr, 1)} />
                  <Stat label="KAST" value={value(profile.metrics.kast, 1, "%")} />
                  <Stat label="FK/100R" value={value(profile.metrics.firstKillPer100)} />
                  <Stat label="UTIL/R" value={value(profile.metrics.utilityDamagePerRound)} />
                </div>
                {(profile.strengths.length > 0 || profile.weaknesses.length > 0) && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <p className="text-sm text-[var(--color-fg)]"><span className="text-[var(--color-ok)]">强项</span> {profile.strengths.join(" · ") || "—"}</p>
                    <p className="text-sm text-[var(--color-fg)]"><span className="text-[var(--color-danger)]">待提升</span> {profile.weaknesses.join(" · ") || "—"}</p>
                  </div>
                )}
                {profile.weapons.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--color-fg-mid)]">
                    {profile.weapons.slice(0, 5).map((weapon) => (
                      <span key={weapon.weapon} className="border border-[var(--color-border)] px-2 py-1">
                        {weapon.label} · {weapon.kills} K · {weapon.killSharePercent.toFixed(1)}%
                      </span>
                    ))}
                  </div>
                )}
              </Panel>
            );
          })}
        </section>
      )}

      {registrations.length === 0 && <Panel pad={32} className="text-center text-[var(--color-fg-mid)]">暂无参赛记录</Panel>}
    </div>
  );
}
