import "server-only";

import { asc, inArray, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { matches, seasons } from "@/db/schema";

const identityIssue = JSON.stringify([{
  code: "IDENTITY_CHANGED",
  path: "participants",
  message: "比赛身份归属已变更，需要重新检查 Demo 数据。",
}]);

type IdentityScope = { steam64: string } | { userId: string };
function identityDependency(scope: IdentityScope) {
  return "steam64" in scope
    ? sql`payload->'participants' @> ${JSON.stringify([{ steamId64: scope.steam64 }])}::jsonb`
    : sql`EXISTS (
        SELECT 1 FROM match_player_stats stats
        WHERE stats.dak_import_id = match_demo_imports.id AND stats.user_id = ${scope.userId}
      ) OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(payload->'participants') participant
        WHERE participant->>'steamId64' IN (
          SELECT steam64 FROM users WHERE id = ${scope.userId} AND steam64 IS NOT NULL
          UNION SELECT steam64 FROM user_gameplay_steam_ids WHERE user_id = ${scope.userId}
        )
      )`;
}

/** A season-scoped retirement audits after global attribution invalidation.
 * Lock every affected event plus the audit event before any import/program row.
 * Caller already owns the identity gate, preventing new confirmations.
 */
export async function readConfirmedDemoIdentityScopeInTx(tx: TxDb, scope: IdentityScope) {
  const result = await tx.execute<{ season_id: string; match_id: string }>(sql`
    SELECT DISTINCT season_id, match_id FROM match_demo_imports
    WHERE status = 'confirmed' AND (${identityDependency(scope)})
  `);
  return result.rows;
}

export async function lockDemoIdentityInvalidationSeasonsInTx(tx: TxDb, scope: IdentityScope, auditSeasonId: string): Promise<void> {
  const affected = await readConfirmedDemoIdentityScopeInTx(tx, scope);
  const ids = [...new Set([auditSeasonId, ...affected.map(row => row.season_id)])].sort();
  await tx.select({ id: seasons.id }).from(seasons).where(inArray(seasons.id, ids)).orderBy(asc(seasons.id)).for("update");
  const matchIds = [...new Set(affected.map(row => row.match_id))].sort();
  if (matchIds.length) await tx.select({ id: matches.id }).from(matches).where(inArray(matches.id, matchIds)).orderBy(asc(matches.id)).for("update");
}

/** Resolve dependencies inside PostgreSQL; never transfer Evidence to invalidate its attribution. */
export async function invalidateConfirmedDemoIdentityInTx(tx: TxDb, scope: IdentityScope): Promise<void> {
  const dependency = identityDependency(scope);
  await tx.execute(sql`
    UPDATE match_demo_imports
    SET status = 'needs_attention', issues = issues || ${identityIssue}::jsonb
    WHERE status = 'confirmed' AND (${dependency})
  `);
}
