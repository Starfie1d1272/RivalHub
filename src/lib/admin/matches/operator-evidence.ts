import "server-only";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { loadOrFetchSteamProfiles, steamProfileDiagnosticUrl } from "@/lib/steam-profiles";

const lineupDifferenceSchema = z.object({ missing: z.array(z.object({ name: z.string(), userId: z.string().uuid().optional(), steam64: z.string().nullable() })).max(10), unexpected: z.array(z.string()).max(10), duplicated: z.array(z.string()).max(10) });

/** Admin-only, bounded projection of the current execution's rejected report. */
export async function loadOperatorEvidence(seasonId: string, matchId: string, sessionId: string, mapEpoch: number, expectedMap?: { id: string; name: string }) {
  const rows = await db.select({ meta: auditLogs.meta, at: auditLogs.createdAt }).from(auditLogs)
    .where(and(eq(auditLogs.seasonId, seasonId), eq(auditLogs.targetId, matchId), eq(auditLogs.action, "mizar.reliable.accept"),
      sql`${auditLogs.meta}->>'sessionId' = ${sessionId}`,
      sql`${auditLogs.meta}->>'mapEpoch' = ${String(mapEpoch)}`,
      sql`${auditLogs.meta}->>'outcome' = 'needs_attention'`))
    .orderBy(desc(auditLogs.createdAt)).limit(20);
  // Prefer the actual mismatching report over later correct-but-disarmed reports.
  const mismatch = expectedMap && rows.find(row => {
    const meta = row.meta as Record<string, unknown> | null;
    return (meta?.kind === "map_ended" || meta?.kind === "map_started") &&
      ((typeof meta.receivedMapId === "string" && meta.receivedMapId !== expectedMap.id) ||
       (typeof meta.receivedMapName === "string" && meta.receivedMapName !== expectedMap.name));
  });
  const row = mismatch || rows[0];
  const meta = row?.meta as Record<string, unknown> | undefined;
  if (!row || !meta) return null;
  const difference = lineupDifferenceSchema.safeParse(meta.lineupDifference).data;
  const ids = difference ? [...difference.missing.flatMap(player => player.steam64 ? [player.steam64] : []), ...difference.unexpected, ...difference.duplicated] : [];
  const profiles = await loadOrFetchSteamProfiles(db, ids);
  const playerIdentity = (steam64: string | null, fallback = "待识别玩家") => ({
    steam64,
    name: (steam64 && profiles.get(steam64)?.personaName) || fallback,
    profileUrl: steam64 && /^\d{17}$/.test(steam64) ? steamProfileDiagnosticUrl(steam64) : null,
  });
  return {
    at: row.at.toISOString(),
    lineupDifference: difference ? {
      missing: difference.missing.map(player => ({ ...player, ...playerIdentity(player.steam64, player.name) })),
      unexpected: difference.unexpected.map(id => playerIdentity(id)),
      duplicated: difference.duplicated.map(id => playerIdentity(id)),
    } : null,
    mapId: typeof meta.receivedMapId === "string" ? meta.receivedMapId : null,
    mapName: typeof meta.receivedMapName === "string" ? meta.receivedMapName : null,
    scoreA: typeof meta.scoreA === "number" ? meta.scoreA : null,
    scoreB: typeof meta.scoreB === "number" ? meta.scoreB : null,
  };
}
