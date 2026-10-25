import "server-only";
import { and, eq, gte, lte, isNull, isNotNull, sql } from "drizzle-orm";
import { db, type DB, type TxDb } from "@/db/client";
import { competitionEntries, competitionEntrySubmissions, educationVerifications, matches, matchTimeProposals, matchVetoSessions, seasons } from "@/db/schema";
import { readAdminPostMatchTasks } from "@/lib/admin/matches/postmatch-tasks";
import { readReopenedPostMatchIds } from "@/lib/postmatch/read";
import { officialMatchCondition } from "@/lib/matches/scope";
import { WorkflowQuery, WORKFLOW_LABELS, type WorkflowData, type WorkflowFilters } from "./contract";

type AggregateRow = { kind: keyof typeof WORKFLOW_LABELS; day: string | null; started: string; resolved: string; waiting: string; approved: string; missing_timing: string; p50: number | null; p90: number | null; oldest_waiting_ms: number | null };
/** Aggregate projections only. Authorization belongs to the caller; no person/object identifiers leave this owner. */
export async function readWorkflowMetrics(database: DB | TxDb, input: WorkflowFilters, now = new Date()): Promise<WorkflowData> {
  const filters = WorkflowQuery.parse(input);
  const from = new Date(now.getTime() - Number(filters.days) * 86400000);
  const event = filters.eventId;
  const result = await database.execute<AggregateRow>(sql`
    with facts as (
      select 'registration'::text as kind, ${competitionEntrySubmissions.submittedAt} as started_at,
        ${competitionEntrySubmissions.decidedAt} as ended_at,
        (${competitionEntrySubmissions.decision} = 'submitted') as waiting,
        (${competitionEntrySubmissions.decision} = 'approved') as approved
      from ${competitionEntrySubmissions} inner join ${competitionEntries} on ${competitionEntries.id} = ${competitionEntrySubmissions.entryId}
      where ${competitionEntrySubmissions.submittedAt} >= ${from} and ${competitionEntrySubmissions.submittedAt} <= ${now}
        and (${event} = '' or ${competitionEntries.competitionId}::text = ${event})
      union all
      select 'education', ${educationVerifications.submittedAt}, ${educationVerifications.reviewedAt},
        (${educationVerifications.status} = 'pending'), (${educationVerifications.status} = 'approved')
      from ${educationVerifications}
      where ${event} = '' and ${educationVerifications.submittedAt} >= ${from} and ${educationVerifications.submittedAt} <= ${now}
      union all
      select 'scheduling', ${matchTimeProposals.createdAt}, ${matchTimeProposals.responseAt},
        (${matchTimeProposals.status} = 'pending'), (${matchTimeProposals.status} = 'accepted')
      from ${matchTimeProposals} inner join ${matches} on ${matches.id} = ${matchTimeProposals.matchId}
      where ${matchTimeProposals.createdAt} >= ${from} and ${matchTimeProposals.createdAt} <= ${now}
        and ${officialMatchCondition()} and ${matches.seasonId} is not null and (${event} = '' or ${matches.seasonId}::text = ${event})
      union all
      select 'veto', ${matchVetoSessions.startedAt}, ${matchVetoSessions.completedAt},
        (${matchVetoSessions.completedAt} is null), (${matchVetoSessions.completedAt} is not null)
      from ${matchVetoSessions} inner join ${matches} on ${matches.id} = ${matchVetoSessions.matchId}
      where ${matchVetoSessions.startedAt} >= ${from} and ${matchVetoSessions.startedAt} <= ${now}
        and ${officialMatchCondition()} and ${matches.seasonId} is not null and (${event} = '' or ${matches.seasonId}::text = ${event})
    ), measured as (
      select *, to_char(started_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD') as day,
        case when not waiting and ended_at >= started_at and ended_at <= ${now}
          then extract(epoch from (ended_at - started_at)) * 1000 end as duration_ms
      from facts
    )
    select kind, day, count(*)::text as started,
      count(*) filter (where not waiting)::text as resolved,
      count(*) filter (where waiting)::text as waiting,
      count(*) filter (where approved)::text as approved,
      count(*) filter (where not waiting and duration_ms is null)::text as missing_timing,
      percentile_disc(0.5) within group (order by duration_ms)::float8 as p50,
      percentile_disc(0.9) within group (order by duration_ms)::float8 as p90,
      max(extract(epoch from (${now}::timestamptz - started_at)) * 1000) filter (where waiting)::float8 as oldest_waiting_ms
    from measured group by grouping sets ((kind), (kind, day)) order by kind, day nulls first
  `);
  const rows = result.rows;
  const completed = await database.select({ id: matches.id, seasonId: matches.seasonId }).from(matches).where(and(
    officialMatchCondition(), isNotNull(matches.seasonId), eq(matches.status, "finished"), gte(matches.completedAt, from), lte(matches.completedAt, now),
    event ? eq(matches.seasonId, event) : undefined));
  const [missing] = await database.select({ n: sql<number>`count(*)::int` }).from(matches).where(and(
    officialMatchCondition(), isNotNull(matches.seasonId), eq(matches.status, "finished"), isNull(matches.completedAt), event ? eq(matches.seasonId, event) : undefined));
  const ids = new Set(completed.map(m => m.id));
  // Reuse the workbench owner for OCR, Demo and production applicability. This is
  // a current-state projection; no first-ready/rework timestamps are inferred.
  const pendingRows = (await Promise.all([...new Set(completed.flatMap(m => m.seasonId ? [m.seasonId] : []))].map(seasonId =>
    readAdminPostMatchTasks(database, seasonId, "", { matchIds: completed.filter(m => m.seasonId === seasonId).map(m => m.id) })))).flat().filter(m => ids.has(m.id));
  const reopened = await readReopenedPostMatchIds(database, [...ids]);
  const postmatch = { finished: completed.length, ready: completed.length - pendingRows.length,
    pending: pendingRows.length, reopened: reopened.size, missingCompletionTime: missing?.n ?? 0,
    note: "按窗口内完赛的正式比赛查看当前资料待办；已齐备表示没有现有工作台待办。待更正来自已有撤回且尚未重提记录，不代表全部历史返工。未记录完赛时间的比赛单列且无法归入窗口；不推算首次齐备时间或返工耗时。" };
  return { postmatch, capturedAt: now.getTime(), from: from.getTime(), filters, rows: Object.entries(WORKFLOW_LABELS)
    .filter(([key]) => key !== "education" || !event)
    .map(([key, labels]) => {
      const total = rows.find(row => row.kind === key && row.day === null);
      return { key, ...labels, started: Number(total?.started ?? 0), resolved: Number(total?.resolved ?? 0), waiting: Number(total?.waiting ?? 0), approved: Number(total?.approved ?? 0), missingTiming: Number(total?.missing_timing ?? 0),
        p50: total?.p50 ?? null, p90: total?.p90 ?? null, oldestWaitingMs: total?.oldest_waiting_ms ?? null,
        trend: rows.filter(row => row.kind === key && row.day !== null).map(row => ({ day: row.day!, started: Number(row.started), resolved: Number(row.resolved), waiting: Number(row.waiting), p50: row.p50, p90: row.p90 })) };
    }) };
}
export async function loadWorkflowMetrics(input: WorkflowFilters) { return readWorkflowMetrics(db, input); }
/** Names only, capped: browser telemetry eventId may be absent from the current catalog. */
export async function loadTelemetryEventNames() {
  const rows = await db.select({ value: seasons.id, label: seasons.name }).from(seasons).orderBy(seasons.createdAt).limit(501);
  return { rows: rows.slice(0, 500), truncated: rows.length > 500 };
}
