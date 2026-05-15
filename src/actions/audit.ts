"use server";

import { and, desc, eq, gte, lt, or, count, like, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { getDisplayName } from "@/lib/utils/display-name";
import { auditLogs, seasons, users, teams, matches, seasonRegistrations, captainVotes, draftPicks, draftState, adminInvites } from "@/db/schema";
import { ok } from "@/types/action";
import { requireSuperAdmin } from "@/lib/auth/session";
import { actionError } from "@/lib/action-utils";

function escapeLike(s: string) {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`);
}

function parseCSTDateStart(value: string) {
  return new Date(`${value}T00:00:00+08:00`);
}

function parseCSTNextDateStart(value: string) {
  const date = parseCSTDateStart(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function positiveInt(value: number | undefined, fallback: number, max?: number) {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  const normalized = Math.floor(value);
  return max ? Math.min(normalized, max) : normalized;
}

export interface AuditLogFilters {
  page?: number;
  pageSize?: number;
  seasonId?: string;
  action?: string;
  actorId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function fetchAuditLogs(filters: AuditLogFilters = {}) {
  try {
    await requireSuperAdmin();

    const {
      page,
      pageSize,
      seasonId,
      action,
      actorId,
      dateFrom,
      dateTo,
    } = filters;

    const safePage = positiveInt(page, 1);
    const safePageSize = positiveInt(pageSize, 50, 100);
    const conditions = [];
    if (seasonId) conditions.push(eq(auditLogs.seasonId, seasonId));
    if (action) conditions.push(like(auditLogs.action, `%${escapeLike(action)}%`));
    if (actorId) conditions.push(like(auditLogs.actorId, `%${escapeLike(actorId)}%`));
    if (dateFrom) conditions.push(gte(auditLogs.createdAt, parseCSTDateStart(dateFrom)));
    if (dateTo) conditions.push(lt(auditLogs.createdAt, parseCSTNextDateStart(dateTo)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [totalRow]] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(safePageSize)
        .offset((safePage - 1) * safePageSize),
      db.select({ count: count() }).from(auditLogs).where(where),
    ]);

    const logs = rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      meta: r.meta as Record<string, unknown> | null,
    }));

    // 构建 actorId → Steam 名称映射
    const actorIds = [...new Set(logs.map((l) => l.actorId).filter((id): id is string => id != null))];
    const actorNameMap: Record<string, string> = {};
    if (actorIds.length) {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const uuidIds = actorIds.filter((id) => UUID_RE.test(id));
      const nonUuidIds = actorIds.filter((id) => !UUID_RE.test(id));

      const clauses = [];
      if (uuidIds.length) clauses.push(inArray(users.id, uuidIds));
      if (nonUuidIds.length) clauses.push(inArray(users.email, nonUuidIds));

      if (clauses.length) {
        const actorUsers = await db
          .select({ id: users.id, email: users.email, steamName: users.steamName, displayName: users.displayName, perfectName: users.perfectName })
          .from(users)
          .where(or(...clauses));
        for (const u of actorUsers) {
          const name = getDisplayName(u);
          actorNameMap[u.id] = name;
          if (u.email) actorNameMap[u.email] = name;
        }
      }
    }

    // 构建 targetId → 可读名称映射
    const targetNameMap: Record<string, string> = {};
    const byType = new Map<string, string[]>();
    for (const l of logs) {
      if (!l.targetId || !l.targetType) continue;
      const list = byType.get(l.targetType) ?? [];
      list.push(l.targetId);
      byType.set(l.targetType, list);
    }

    const resolvers: Promise<void>[] = [];

    const userTypeIds = [...new Set([...(byType.get("user") ?? []), ...(byType.get("admin_user") ?? [])])];
    if (userTypeIds.length) {
      resolvers.push(
        db.select({ id: users.id, email: users.email, steamName: users.steamName, displayName: users.displayName, perfectName: users.perfectName })
          .from(users).where(inArray(users.id, userTypeIds))
          .then((rows) => { for (const u of rows) targetNameMap[u.id] = getDisplayName(u); }),
      );
    }

    const seasonIds = [...new Set([...(byType.get("season") ?? []), ...(byType.get("draft_state") ?? [])])];
    if (seasonIds.length) {
      resolvers.push(
        db.select({ id: seasons.id, name: seasons.name }).from(seasons).where(inArray(seasons.id, seasonIds))
          .then((rows) => { for (const s of rows) targetNameMap[s.id] = s.name; }),
      );
    }

    const teamIds = byType.get("team");
    if (teamIds?.length) {
      resolvers.push(
        db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds))
          .then((rows) => { for (const t of rows) targetNameMap[t.id] = t.name; }),
      );
    }

    const regIds = byType.get("registration");
    if (regIds?.length) {
      resolvers.push(
        db.select({ id: seasonRegistrations.id, uid: users.id, email: users.email, steamName: users.steamName, displayName: users.displayName, perfectName: users.perfectName })
          .from(seasonRegistrations).innerJoin(users, eq(seasonRegistrations.userId, users.id))
          .where(inArray(seasonRegistrations.id, regIds))
          .then((rows) => { for (const r of rows) targetNameMap[r.id] = getDisplayName(r); }),
      );
    }

    const matchIds = byType.get("match");
    if (matchIds?.length) {
      const tA = db.$with("ta").as(db.select({ id: teams.id, name: teams.name }).from(teams));
      const tB = db.$with("tb").as(db.select({ id: teams.id, name: teams.name }).from(teams));
      resolvers.push(
        db.select({ id: matches.id, aName: teams.name, bId: matches.teamBId })
          .from(matches)
          .innerJoin(teams, eq(matches.teamAId, teams.id))
          .where(inArray(matches.id, matchIds))
          .then(async (rows) => {
            const bIds = [...new Set(rows.map((r) => r.bId))];
            const bMap: Record<string, string> = {};
            if (bIds.length) {
              const bRows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, bIds));
              for (const b of bRows) bMap[b.id] = b.name;
            }
            for (const r of rows) targetNameMap[r.id] = `${r.aName} vs ${bMap[r.bId] ?? "?"}`;
          }),
      );
    }

    const inviteIds = byType.get("admin_invite");
    if (inviteIds?.length) {
      resolvers.push(
        db.select({ id: adminInvites.id, code: adminInvites.code }).from(adminInvites).where(inArray(adminInvites.id, inviteIds))
          .then((rows) => { for (const i of rows) targetNameMap[i.id] = `邀请码 ${i.code}`; }),
      );
    }

    const voteIds = byType.get("captain_vote");
    if (voteIds?.length) {
      resolvers.push(
        db.select({
          id: captainVotes.id,
          voterId: captainVotes.voterRegistrationId,
          candidateId: captainVotes.candidateRegistrationId,
        }).from(captainVotes).where(inArray(captainVotes.id, voteIds))
          .then(async (rows) => {
            const allRegIds = [...new Set(rows.flatMap((r) => [r.voterId, r.candidateId]))];
            const regMap: Record<string, string> = {};
            if (allRegIds.length) {
              const regRows = await db.select({ id: seasonRegistrations.id, email: users.email, steamName: users.steamName, displayName: users.displayName, perfectName: users.perfectName })
                .from(seasonRegistrations).innerJoin(users, eq(seasonRegistrations.userId, users.id))
                .where(inArray(seasonRegistrations.id, allRegIds));
              for (const r of regRows) regMap[r.id] = getDisplayName(r);
            }
            for (const v of rows) targetNameMap[v.id] = `${regMap[v.voterId] ?? "?"} → ${regMap[v.candidateId] ?? "?"}`;
          }),
      );
    }

    const pickIds = byType.get("draft_pick");
    if (pickIds?.length) {
      resolvers.push(
        db.select({ id: draftPicks.id, regId: draftPicks.registrationId, teamId: draftPicks.teamId, round: draftPicks.round })
          .from(draftPicks).where(inArray(draftPicks.id, pickIds))
          .then(async (rows) => {
            const rIds = [...new Set(rows.map((r) => r.regId))];
            const tIds = [...new Set(rows.map((r) => r.teamId))];
            const [regRows, teamRows] = await Promise.all([
              rIds.length ? db.select({ id: seasonRegistrations.id, email: users.email, steamName: users.steamName, displayName: users.displayName, perfectName: users.perfectName })
                .from(seasonRegistrations).innerJoin(users, eq(seasonRegistrations.userId, users.id))
                .where(inArray(seasonRegistrations.id, rIds)) : [],
              tIds.length ? db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, tIds)) : [],
            ]);
            const regMap: Record<string, string> = {};
            for (const r of regRows) regMap[r.id] = getDisplayName(r);
            const tMap: Record<string, string> = {};
            for (const t of teamRows) tMap[t.id] = t.name;
            for (const p of rows) targetNameMap[p.id] = `${regMap[p.regId] ?? "?"} → ${tMap[p.teamId] ?? "?"}`;
          }),
      );
    }

    await Promise.all(resolvers);

    return ok({ logs, total: Number(totalRow?.count ?? 0), actorNameMap, targetNameMap });
  } catch (e) {
    return actionError("fetchAuditLogs", e);
  }
}

export async function getAuditSeasons() {
  try {
    await requireSuperAdmin();
    const rows = await db.query.seasons.findMany({
      columns: { id: true, name: true },
      orderBy: [desc(seasons.createdAt)],
    });
    return ok(rows);
  } catch (e) {
    return actionError("getAuditSeasons", e);
  }
}
