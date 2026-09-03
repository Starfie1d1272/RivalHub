import Link from "next/link";
import { and, eq, inArray, or } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { competitionEntries, eventRosterMembers, eventRosters, matches, seasonRegistrations, users } from "@/db/schema";
import { Marker, Panel, PosChip, Stat, StatusBanner } from "@/components/rivalhub";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { presentCompetitionEntryRegistration } from "@/lib/competition-entries/presentation";
import { presentMatchStatus } from "@/lib/matches/presentation";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";

export default async function CompetitionEntryDetailPage({ params }: { params: Promise<{ seasonSlug: string; teamId: string }> }) {
  const { seasonSlug, teamId: entryId } = await params;
  const season = await getPublicOrAuthorizedDraftSeason(seasonSlug);
  if (!season) notFound();
  const entry = await db.query.competitionEntries.findFirst({ where: and(eq(competitionEntries.id, entryId), eq(competitionEntries.competitionId, season.id)) });
  if (!entry) notFound();
  const [roster, entryMatches] = await Promise.all([
    db.select({ userId: users.id, steamName: users.steamName, perfectName: users.perfectName, displayName: users.displayName, primaryPosition: seasonRegistrations.primaryPosition, isStarter: eventRosterMembers.isPrimaryStarter, rosterStatus: eventRosters.status }).from(eventRosterMembers).innerJoin(eventRosters, eq(eventRosters.id, eventRosterMembers.eventRosterId)).innerJoin(users, eq(users.id, eventRosterMembers.userId)).leftJoin(seasonRegistrations, and(eq(seasonRegistrations.userId, users.id), eq(seasonRegistrations.seasonId, season.id))).where(eq(eventRosters.entryId, entry.id)),
    db.query.matches.findMany({ where: and(eq(matches.seasonId, season.id), or(eq(matches.entryAId, entry.id), eq(matches.entryBId, entry.id))) }),
  ]);
  const opponentIds = [...new Set(entryMatches.map((match) => match.entryAId === entry.id ? match.entryBId : match.entryAId))];
  const opponents = opponentIds.length ? await db.query.competitionEntries.findMany({ where: inArray(competitionEntries.id, opponentIds) }) : [];
  const names = new Map(opponents.map((opponent) => [opponent.id, opponent.name]));
  let wins = 0; let losses = 0;
  for (const match of entryMatches.filter((row) => row.status === "finished")) { const own = match.entryAId === entry.id ? match.scoreA : match.scoreB; const other = match.entryAId === entry.id ? match.scoreB : match.scoreA; if ((own ?? 0) > (other ?? 0)) wins += 1; else losses += 1; }
  return <div className="container mx-auto max-w-4xl space-y-8 px-4 py-12">
    <div><p className="mb-2 text-xs text-[var(--color-fg-mid)]"><Link href={`/${seasonSlug}/teams`} className="hover:underline">赛事队伍</Link></p><Marker sub={season.name}>{entry.name}</Marker></div>
    <StatusBanner tone={entry.registrationStatus === "approved" ? "success" : "info"} title={`报名状态：${presentCompetitionEntryRegistration(entry.registrationStatus).label}`} sub={entry.teamId ? "赛事期间会保留当时的队名和图标。" : "这是为本届赛事组成的队伍。"} />
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="PLAYED" value={wins + losses} /><Stat label="WINS" value={wins} /><Stat label="LOSSES" value={losses} /><Stat label="ROSTER" value={roster.length} accent /></div>
      <Panel label="参赛名单" pad={20}><div className="divide-y divide-[var(--color-border)]">{roster.length ? roster.map((member) => <div key={member.userId} className="flex items-center justify-between py-3"><div className="flex items-center gap-2">{member.isStarter && <PosChip pos="S" small />}<Link href={`/players/${member.userId}`} className="font-medium hover:text-[var(--color-accent)]">{getPublicDisplayName(member)}</Link>{member.userId === entry.representativeUserId && <PosChip pos="R" small />}</div><span className="text-xs text-[var(--color-fg-mid)]">{member.primaryPosition ?? "—"} · {member.rosterStatus === "frozen" ? "名单已确认" : "名单准备中"}</span></div>) : <p className="text-sm text-[var(--color-fg-mid)]">名单尚未确认。</p>}</div></Panel>
    <Panel label="比赛" pad={20}><div className="space-y-2">{entryMatches.length ? entryMatches.map((match) => { const opponentId = match.entryAId === entry.id ? match.entryBId : match.entryAId; return <Link key={match.id} href={`/${seasonSlug}/matches/${match.id}`} className="flex justify-between border border-[var(--color-border)] p-3 text-sm hover:bg-[var(--color-panel-hi)]"><span>对阵 {names.get(opponentId) ?? "待定"}</span><span>{presentMatchStatus(match.status, { isForfeit: match.isForfeit, scheduledAt: match.scheduledAt }).label}{match.scoreA !== null && match.scoreB !== null ? ` · ${match.scoreA}:${match.scoreB}` : ""}</span></Link>; }) : <p className="text-sm text-[var(--color-fg-mid)]">暂无比赛。</p>}</div></Panel>
  </div>;
}
