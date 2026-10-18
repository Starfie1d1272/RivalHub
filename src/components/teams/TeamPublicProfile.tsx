import { TeamRoster } from "./TeamRoster";
import { TeamMatches } from "./TeamMatches";
import { TeamCareer, TeamHistory, TeamRecruitment } from "./TeamProfileHistory";
import { TeamMapProfile } from "./TeamMapProfile";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { TeamRosterMapContext, TeamWorkspace } from "@/components/stats/teams/TeamWorkspace";
import type { PublicTeamMapProfile } from "@/lib/teams/map-profile";
import type { PublicSeasonResults } from "@/lib/seasons/public-results";
import type { LongTeamCareerDetail, TournamentTeamDetail } from "@/lib/stats/tournament-query";
import React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PageHeader, StatusPill } from "@/components/rivalhub";
import { TeamLogo } from "@/components/teams/TeamLogo";
import type { PublicEventTeamContext } from "@/lib/competition-entries/public-team-context";
import type { PublicTeamProfile } from "@/lib/teams/public-profile";
import type { PublicLongTeamProfileReadModel } from "@/lib/teams/profile-read-model";
import { presentTeamMembershipStatus, presentTeamStatus } from "@/lib/teams/presentation";

export interface TeamPublicProfileProps {
  team: PublicTeamProfile | null;
  mapProfile?: PublicTeamMapProfile;
  results?: PublicSeasonResults;
  event?: PublicEventTeamContext | null;
  performance?: LongTeamCareerDetail | TournamentTeamDetail | null;
  career?: PublicLongTeamProfileReadModel["career"];
  matches?: PublicLongTeamProfileReadModel["matches"];
  statsUnavailable?: boolean;
}

export function TeamPublicProfile({ team, event = null, mapProfile, results, performance, career = [], matches = [], statsUnavailable = false }: TeamPublicProfileProps) {
  const identity = event?.entry ?? team?.team;
  if (!identity) return null;

  const currentMembers = team?.currentMembers ?? [];
  const currentUserMembership = team?.currentUserMembership ?? null;
  const membershipLabel = currentUserMembership && team
    ? `我的队伍 · ${team.team.captainUserId === currentUserMembership.userId ? "队长" : "成员"}`
    : null;
  const currentEntries = team?.entries.filter((entry) => !["finished", "archived"].includes(entry.seasonStatus)) ?? [];
  const eventPlacement = event ? results?.placements.find((entry) => entry.entryId === event.entry.id) ?? null : null;
  const eventHonors = event ? results?.honors.filter((honor) => honor.entryId === event.entry.id) ?? [] : [];
  const eventDetail = event && performance && !("linkedEntries" in performance) ? performance : null;
  const longDetail = !event && performance && "linkedEntries" in performance ? performance : null;
  const headline = event ? {
    matches: eventDetail?.results ? `${eventDetail.results.matchWins}-${eventDetail.results.matchLosses}` : `${event.record.wins}-${event.record.losses}`,
    maps: eventDetail?.results ? `${eventDetail.results.mapWins}-${eventDetail.results.mapLosses}` : "—",
    mapCount: eventDetail?.results?.maps ?? "—",
  } : {
    matches: longDetail ? `${longDetail.results.wins}-${longDetail.results.losses}` : `${team?.wins ?? 0}-${Math.max((team?.playedCount ?? 0) - (team?.wins ?? 0), 0)}`,
    maps: longDetail ? `${longDetail.results.mapWins}-${longDetail.results.mapLosses}` : "—",
    mapCount: longDetail?.results.maps ?? "—",
  };
  const hasOwnMaps = eventDetail
    ? eventDetail.maps.some((row) => (row.results?.played ?? 0) > 0)
    : longDetail
      ? longDetail.maps.some((row) => (row.results?.played ?? 0) > 0)
      : Boolean(mapProfile?.own.some((map) => map.played > 0));
  const eventRosterHeading = event && (event.season.status === "finished" || event.season.status === "archived")
    ? "本届名单"
    : event?.rosterLabel ?? "本届名单";

  const detail = eventDetail ?? longDetail;
  const members = event
    ? event.roster.toSorted((a, b) => Number(b.isStarter) - Number(a.isStarter)).map(member => ({
      ...member, label: member.isStarter ? "首发" : "替补",
    }))
    : currentMembers.map(member => ({
      ...member, captain: member.userId === team?.team.captainUserId,
      label: member.status === "active" ? undefined : presentTeamMembershipStatus(member.status).label,
    }));
  const matchRows = event ? event.matches.map(match => ({ ...match, seasonSlug: event.season.slug })) : matches;

  return (
    <div className="min-w-0 space-y-6">
      <div className="overflow-hidden border border-[var(--color-border)] bg-[var(--color-panel)]">
        <div className="p-4">
          <PageHeader
            className="border-0 pb-0"
            title={(
              <span className="flex min-w-0 items-center gap-4">
                <TeamLogo logoUrl={identity.logoUrl} teamName={identity.name} size="lg" className="h-14 w-14" />
                <span className="min-w-0 break-words">{identity.name}</span>
              </span>
            )}
            eyebrow={event ? event.season.name : "Team"}
            description={event ? null : (team?.team.description ?? "暂无队伍简介。")}
            status={event ? (
              eventPlacement ? <StatusPill label={eventPlacement.label} tone="accent" /> : null
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {team && <StatusPill {...presentTeamStatus(team.team.status)} />}
                {team?.team.status === "active" && team.recruitment && <StatusPill label="招募中" tone="accent" />}
                {currentUserMembership && <StatusPill label={membershipLabel ?? "我的队伍 · 成员"} tone="accent" />}
              </div>
            )}
            actions={event ? (
              <div className="flex flex-wrap items-center gap-3">
                {team && <TeamProfileLink slug={team.team.slug} className="text-sm text-[var(--color-accent)] hover:underline">队伍主页 · {team.team.name}</TeamProfileLink>}
                <Link href={`/${event.season.slug}/teams`} className="text-sm text-[var(--color-fg-secondary)] hover:text-[var(--color-fg-primary)]">返回参赛阵容</Link>
              </div>
            ) : (team && currentUserMembership && team.team.status === "active") ? (
              <Button size="sm" asChild><Link href="/my/teams">管理我的队伍</Link></Button>
            ) : null}
          />
          {eventHonors.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{eventHonors.map((honor) => <span key={honor.id} className="text-sm font-semibold text-[var(--color-accent)]">{honor.label}</span>)}</div>}
        </div>
        <div className="grid grid-cols-2 border-t border-[var(--color-border)] sm:grid-cols-4">
          {[
            { label: "Match W-L", value: headline.matches },
            { label: "Map W-L", value: headline.maps },
            { label: "Maps", value: headline.mapCount },
            { label: "Rating", value: performance?.teamRating ? performance.teamRating.rating.toFixed(2) : "—" },
          ].map(({ label, value }, index) => (
            <div key={label} className={`px-5 py-3 ${index % 2 ? "border-l" : ""} border-[var(--color-border)] sm:border-l sm:first:border-l-0`}>
              <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-dim)]">{label}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {statsUnavailable && <p role="status" className="text-sm text-[var(--color-fg-mid)]">竞技统计暂时无法加载，请稍后重试。</p>}

      {!event && currentEntries.length > 0 && <div className="border-y border-[var(--color-border)] py-3"><p className="mb-2 text-xs font-medium text-[var(--color-fg-dim)]">当前赛事</p><div className="space-y-2">{currentEntries.map(entry => <TeamProfileLink key={entry.id} className="flex items-center justify-between gap-3 text-sm hover:text-[var(--color-accent)]" seasonSlug={entry.seasonSlug} entryId={entry.id}><span><span className="font-medium">{entry.seasonName}</span><span className="ml-2 text-[var(--color-fg-mid)]">{entry.name}</span></span><span>→</span></TeamProfileLink>)}</div></div>}
      <TeamRoster title={event ? eventRosterHeading : "当前成员"} members={members} />
      {!event && team && <TeamRecruitment team={team} />}
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {detail && <TeamMapProfile title={event ? "本届地图画像" : "生涯地图画像"} maps={detail.maps.map(({ mapName, results, selection }) => ({ mapName, results, selection }))} samples={detail.vetoActionSamples} />}
        <TeamMatches matches={matchRows} />
      </div>
      {detail && <section className="space-y-4"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">PERFORMANCE</p><h2 className="mt-1 text-lg font-semibold">竞技表现</h2></div><TeamWorkspace detail={detail} /></section>}
      {mapProfile && <TeamRosterMapContext mapProfile={mapProfile} hasOwnMaps={hasOwnMaps} />}
      {!event && team && <><TeamCareer career={career} /><TeamHistory team={team} /></>}
    </div>
  );
}
