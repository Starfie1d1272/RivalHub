import "server-only";

import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { db, type DB } from "@/db/client";
import { matchDemoStatProjections, seasons } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import type { CompactRecordEvent, RecordEventKind } from "./record-facts";
import { STATISTICS_PROJECTION_VERSION } from "./projection-version";
import { loadStatsEvidenceSelection, type ProjectionTargets } from "./tournament-projections";
import type { PlatformStatsScope } from "./types";

const RECORD_EVENT_PAGE_SIZE = 25;
export interface RecordEventOccurrence extends CompactRecordEvent {
  eventName: string;
  eventSlug: string;
  matchId: string;
  mapId: string;
  mapName: string;
  entityName: string;
  teamName: string;
  teamHref: string;
  opponent: string;
  opponentHref: string;
  victimName?: string;
  score: string;
}
export interface RecordEventPage {
  rows: RecordEventOccurrence[];
  total: number;
  page: number;
  pages: number;
  maps: number;
  weapons: string[];
}
/** Same current-import / revision / identity selection as analytics, with DB-side event pagination. */
export async function getTournamentRecordEvents(
  scope: PlatformStatsScope,
  filter: { eventType?: RecordEventKind | ""; eventWeapon?: string; eventPage?: number },
  database: DB = db,
): Promise<RecordEventPage> {
  const page = filter.eventPage ?? 1;
  if (!Number.isSafeInteger(page) || page < 1 || page > 999999)
    throw new AppError(ErrorCode.NOT_FOUND, "事件页不可用。");
  return database.transaction(
    async (tx) => {
      if (!scope.seasonId || scope.publicOnly) {
        const events = await tx
          .select({ id: seasons.id })
          .from(seasons)
          .where(
            and(
              ne(seasons.status, "draft"),
              scope.seasonIds ? inArray(seasons.id, scope.seasonIds) : undefined,
              scope.seasonId ? eq(seasons.id, scope.seasonId) : undefined,
            ),
          );
        if (scope.seasonId && !events.some((event) => event.id === scope.seasonId))
          throw new AppError(ErrorCode.NOT_FOUND, "统计范围不可用。");
        scope = { ...scope, seasonIds: events.map((event) => event.id) };
      }
      const loaded = await loadStatsEvidenceSelection(
        tx,
        scope,
        {},
        sql<ProjectionTargets>`jsonb_build_object(
      'tournament', jsonb_build_object('mapKey', ${matchDemoStatProjections.facts}->'tournament'->'mapKey', 'matchKey', ${matchDemoStatProjections.facts}->'tournament'->'matchKey'),
      'performance', jsonb_build_object('mapKey', ${matchDemoStatProjections.facts}->'performance'->'mapKey', 'matchKey', ${matchDemoStatProjections.facts}->'performance'->'matchKey'))`,
      );
      const ids = loaded.selected.map((row) => row.importId);
      if (!ids.length) {
        if (page > 1) throw new AppError(ErrorCode.NOT_FOUND, "事件页不可用。");
        return { rows: [], total: 0, page: 1, pages: 1, maps: 0, weapons: [] };
      }
      const source = sql`LATERAL jsonb_array_elements(COALESCE(${matchDemoStatProjections.facts}->'records'->'events', '[]'::jsonb)) WITH ORDINALITY AS occurrence(event, position)`;
      const base = and(
        inArray(matchDemoStatProjections.importId, ids),
        eq(matchDemoStatProjections.projectionVersion, STATISTICS_PROJECTION_VERSION),
      );
      const typeCondition = filter.eventType
        ? sql`occurrence.event->>'kind' = ${filter.eventType}`
        : undefined;
      const condition = and(
        base,
        typeCondition,
        filter.eventWeapon
          ? sql`(occurrence.event->>'weapon' = ${filter.eventWeapon} OR occurrence.event->'weapons' ? ${filter.eventWeapon})`
          : undefined,
      );
      const [countRow] = await tx
        .select({ total: count() })
        .from(matchDemoStatProjections)
        .innerJoin(source, sql`true`)
        .where(condition);
      const total = Number(countRow?.total ?? 0),
        pages = Math.max(1, Math.ceil(total / RECORD_EVENT_PAGE_SIZE));
      if (page > pages) throw new AppError(ErrorCode.NOT_FOUND, "事件页不可用。");
      const weaponRows = await tx
        .selectDistinct({ weapon: sql<string>`weapon.value #>> '{}'` })
        .from(matchDemoStatProjections)
        .innerJoin(source, sql`true`)
        .innerJoin(
          sql`LATERAL jsonb_array_elements(COALESCE(occurrence.event->'weapons', jsonb_build_array(occurrence.event->'weapon'))) AS weapon(value)`,
          sql`true`,
        )
        .where(and(base, typeCondition));
      const weapons = weaponRows
        .map((row) => row.weapon)
        .filter((weapon): weapon is string => Boolean(weapon))
        .sort();
      const rows = await tx
        .select({
          importId: matchDemoStatProjections.importId,
          event: sql<CompactRecordEvent>`occurrence.event`,
        })
        .from(matchDemoStatProjections)
        .innerJoin(source, sql`true`)
        .where(condition)
        .orderBy(
          matchDemoStatProjections.importId,
          sql`(occurrence.event->>'round')::int`,
          sql`occurrence.position`,
        )
        .limit(RECORD_EVENT_PAGE_SIZE)
        .offset((page - 1) * RECORD_EVENT_PAGE_SIZE);
      const refs = new Map(loaded.currentRefs.map((ref) => [ref.current.id, ref]));
      const entries = new Map(loaded.entryRows.map((entry) => [entry.id, entry]));
      return {
        total,
        page,
        pages,
        maps: loaded.selected.length,
        weapons,
        rows: rows.map(({ importId, event }) => {
          const { map, match } = refs.get(importId)!;
          const entry = entries.get(event.entryId)!;
          const opponent = entries.get(
            event.entryId === match.entryAId ? match.entryBId : match.entryAId,
          )!;
          return {
            ...event,
            eventName: entry.eventName,
            eventSlug: entry.eventSlug,
            matchId: match.id,
            mapId: map.id,
            mapName: map.mapName,
            entityName: loaded.labels.players[event.entityId] ?? "选手",
            teamName: entry.name,
            teamHref: `/${entry.eventSlug}/teams/${entry.id}`,
            opponent: opponent.name,
            opponentHref: `/${opponent.eventSlug}/teams/${opponent.id}`,
            victimName: event.victimId
              ? (loaded.labels.players[event.victimId] ?? "选手")
              : undefined,
            score: `${event.scoreA}-${event.scoreB}`,
          };
        }),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
