import "server-only";
import { createHash } from "node:crypto";
import { getTableColumns, sql } from "drizzle-orm";
import { matchPlayerStats } from "@/db/schema/player-stats";
import type { ScoreboardCommand, ScoreboardOperation } from "./scoreboard-contract";

// Preserve PostgreSQL timestamp precision rather than relying on JS millisecond
// dates when a provenance-only write is the competing change.
export const scoreboardVersionColumns = { ...getTableColumns(matchPlayerStats),
  verifiedAtExact: sql<string | null>`extract(epoch from ${matchPlayerStats.verifiedAt})::text`,
  createdAtExact: sql<string>`extract(epoch from ${matchPlayerStats.createdAt})::text`,
};
export type ScoreboardVersionRow = typeof matchPlayerStats.$inferSelect & { verifiedAtExact: string | null; createdAtExact: string };

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
      : item)).digest("hex");
}
/** Opaque content version, not a monotonic sequence. Internal facts never leave the server. */
export function scoreboardVersion(mapId: string, rows: readonly ScoreboardVersionRow[]): string {
  return digest({ scope: "operator-scoreboard-v1", mapId, rows: [...rows].sort((a, b) => a.id.localeCompare(b.id)) });
}
export function scoreboardPayloadDigest(mapId: string, operation: ScoreboardOperation, command: ScoreboardCommand, rows: readonly { userId: string | null }[] = []): string {
  return digest({ scope: "operator-scoreboard-command-v1", mapId, operation, expectedVersion: command.expectedVersion, expectedActor: command.expectedActor,
    rows: [...rows].sort((a, b) => (a.userId ?? "").localeCompare(b.userId ?? "")) });
}
