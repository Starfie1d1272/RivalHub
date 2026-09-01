import { asc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { matchCommentators, matches, postMatchReports, seasonAdminGrants, seasons, users } from "@/db/schema";
import { PostMatchOperations } from "@/components/admin/PostMatchOperations";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getDisplayName } from "@/lib/identity/display-name";

export default async function PostMatchPage({ params }: { params: Promise<{ seasonSlug: string }> }) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({ where: eq(seasons.slug, seasonSlug) });
  if (!season) notFound();
  const admin = await requireSeasonAdmin(season.id);
  const [seasonAdmins, seasonMatches] = await Promise.all([
    db.select({ id: users.id, displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName, email: users.email }).from(seasonAdminGrants).innerJoin(users, eq(seasonAdminGrants.userId, users.id)).where(eq(seasonAdminGrants.seasonId, season.id)).orderBy(asc(users.displayName)),
    db.query.matches.findMany({ where: eq(matches.seasonId, season.id), orderBy: [asc(matches.scheduledAt), asc(matches.createdAt)] }),
  ]);
  const finished = seasonMatches.filter((match) => match.status === "finished");
  const matchIds = finished.map((match) => match.id);
  const [commentatorRows, reportRows] = matchIds.length ? await Promise.all([
    db.select({ matchId: matchCommentators.matchId, userId: users.id, displayName: users.displayName, perfectName: users.perfectName, steamName: users.steamName, email: users.email, confirmedFeeCents: matchCommentators.confirmedFeeCents, settledAt: matchCommentators.settledAt }).from(matchCommentators).innerJoin(users, eq(matchCommentators.userId, users.id)).where(inArray(matchCommentators.matchId, matchIds)),
    db.select().from(postMatchReports).where(inArray(postMatchReports.matchId, matchIds)),
  ]) : [[], []];
  const commentatorsByMatch = new Map<string, typeof commentatorRows>();
  for (const row of commentatorRows) commentatorsByMatch.set(row.matchId, [...(commentatorsByMatch.get(row.matchId) ?? []), row]);
  const reports = new Map(reportRows.map((row) => [row.matchId, row]));
  const settlementMap = new Map<string, { userId: string; name: string; confirmedMatches: number; pendingMatches: number; payableCents: number; settledCents: number }>();
  for (const row of commentatorRows) {
    if (row.confirmedFeeCents == null) continue;
    const item = settlementMap.get(row.userId) ?? { userId: row.userId, name: getDisplayName(row), confirmedMatches: 0, pendingMatches: 0, payableCents: 0, settledCents: 0 };
    item.confirmedMatches += 1;
    if (row.settledAt) item.settledCents += row.confirmedFeeCents;
    else { item.pendingMatches += 1; item.payableCents += row.confirmedFeeCents; }
    settlementMap.set(row.userId, item);
  }
  return <div className="space-y-6"><div><h1 className="text-2xl font-bold">赛后记录与解说结算 · {season.name}</h1><p className="mt-1 text-sm text-[var(--color-fg-mid)]">比赛数据仍由比分、逐图和玩家统计原表持有；这里仅记录实际解说、完成节点与结算事实。</p></div><PostMatchOperations data={{ seasonId: season.id, currentUserId: admin.userId, feeCents: season.commentatorFeeCents, admins: seasonAdmins.map((user) => ({ id: user.id, name: getDisplayName(user) })), matches: finished.map((match) => ({ id: match.id, label: `${match.stage}${match.round ? ` · 第 ${match.round} 轮` : ""} · ${match.id.slice(0, 8)}`, videoUrl: match.videoUrl, commentators: (commentatorsByMatch.get(match.id) ?? []).map((row) => ({ userId: row.userId, name: getDisplayName(row), confirmedFeeCents: row.confirmedFeeCents, settledAt: row.settledAt })), report: reports.get(match.id) ? { status: reports.get(match.id)!.status, submittedByUserId: reports.get(match.id)!.submittedByUserId, returnReason: reports.get(match.id)!.returnReason } : null })), settlements: [...settlementMap.values()] }} /></div>;
}
