import "server-only";

import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import { matches, seasons, steamProfiles, users, type AuditLog } from "@/db/schema";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { auditActorKey, resolveAuditActors } from "./actors";
import { describeAuditDetail } from "./detail";
import { getAuditContextUserReferences, isAuditUserEmail, isAuditUserId, summarizeAuditPeople } from "./people";
import { getAuditActionPresentation, getAuditTargetTypeLabel, summarizeAuditMeta, type AuditLogDetail, type AuditLogView } from "./presentation";
import { auditTargetKey, normalizeAuditTarget, resolveAuditTargets } from "./targets";

async function projectAuditRows(rows: readonly AuditLog[]) {
  const actorIds = [...new Set(rows.flatMap(row => row.actorId ? [row.actorId] : []))];
  const contextUserIds = rows.flatMap(row => [...getAuditContextUserReferences(row.action, row.meta).values()]);
  const uuidIds = [...new Set([...actorIds.filter(isAuditUserId), ...contextUserIds])];
  const emailIds = actorIds.filter(isAuditUserEmail);
  const userClauses = [
    ...(uuidIds.length ? [inArray(users.id, uuidIds)] : []),
    ...(emailIds.length ? [inArray(users.email, emailIds)] : []),
  ];
  const seasonIds = [...new Set(rows.flatMap(row => row.seasonId ? [row.seasonId] : []))];
  const [actorUsers, seasonRows, targets] = await Promise.all([
    userClauses.length ? db.select({ id: users.id, email: users.email, personaName: steamProfiles.personaName, displayName: users.displayName, perfectName: users.perfectName })
      .from(users).leftJoin(steamProfiles, eq(steamProfiles.steam64, users.steam64)).where(or(...userClauses)) : [],
    seasonIds.length ? db.select({ id: seasons.id, name: seasons.name, slug: seasons.slug }).from(seasons).where(inArray(seasons.id, seasonIds)) : [],
    resolveAuditTargets(rows),
  ]);
  const names = new Map<string, string>();
  for (const user of actorUsers) {
    const name = getPublicDisplayName(user);
    names.set(user.id, name);
    if (user.email) names.set(user.email, name);
  }
  const seasonMap = new Map(seasonRows.map(season => [season.id, season]));
  const actors = await resolveAuditActors(rows, names);
  const logs: AuditLogView[] = rows.map(row => {
    const action = getAuditActionPresentation(row.action);
    const ref = normalizeAuditTarget(row);
    const target = ref.targetType && ref.targetId ? targets[auditTargetKey(ref.targetType, ref.targetId)] : undefined;
    const peopleSummary = summarizeAuditPeople(row.action, row.meta, names);
    const metaSummary = summarizeAuditMeta(row.action, row.meta);
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      actionKey: row.action,
      actionLabel: action.label,
      categoryLabel: action.categoryLabel,
      categoryColor: action.categoryColor,
      actorLabel: actors.get(auditActorKey(row))?.label ?? "未知来源",
      targetTypeLabel: target?.typeLabel ?? getAuditTargetTypeLabel(ref.targetType),
      targetLabel: target?.label ?? "未指定目标",
      summary: [peopleSummary, metaSummary === "已记录" && peopleSummary ? null : metaSummary].filter(Boolean).join(" · ") || null,
      seasonLabel: row.seasonId ? seasonMap.get(row.seasonId)?.name ?? "历史赛事" : "全局操作",
    };
  });
  return { logs, names, actors, targets, seasonMap };
}

/** Callers must enforce global/season authorization before providing immutable rows. */
export async function readAuditLogViews(rows: readonly AuditLog[]): Promise<AuditLogView[]> {
  return (await projectAuditRows(rows)).logs;
}

export async function readAuditLogDetail(row: AuditLog): Promise<AuditLogDetail> {
  const result = await projectAuditRows([row]);
  const ref = normalizeAuditTarget(row);
  const target = ref.targetType && ref.targetId ? result.targets[auditTargetKey(ref.targetType, ref.targetId)] : undefined;
  const season = row.seasonId ? result.seasonMap.get(row.seasonId) : undefined;
  const linkedMatch = target?.found && ref.targetType === "match" && ref.targetId && season
    ? await db.select({ id: matches.id }).from(matches).where(and(eq(matches.id, ref.targetId), eq(matches.seasonId, season.id))).limit(1) : [];
  return {
    ...result.logs[0]!,
    ...describeAuditDetail(row.action, row.meta, result.names),
    authorizedByLabel: result.actors.get(auditActorKey(row))?.authorizedByLabel ?? null,
    targetContext: target?.context ?? null,
    targetHref: linkedMatch.length > 0 && ref.targetId && season
      ? `/admin/${encodeURIComponent(season.slug)}/matches/${encodeURIComponent(ref.targetId)}` : null,
  };
}
