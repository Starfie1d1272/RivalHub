import "server-only";

import { sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";

const identityIssue = JSON.stringify([{
  code: "IDENTITY_CHANGED",
  path: "participants",
  message: "比赛身份归属已变更，需要重新检查 Demo 数据。",
}]);

/** Resolve dependencies inside PostgreSQL; never transfer Evidence to invalidate its attribution. */
export async function invalidateConfirmedDemoIdentityInTx(
  tx: TxDb,
  scope: { steam64: string } | { userId: string },
): Promise<void> {
  const dependency = "steam64" in scope
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
  await tx.execute(sql`
    UPDATE match_demo_imports
    SET status = 'needs_attention', issues = issues || ${identityIssue}::jsonb
    WHERE status = 'confirmed' AND (${dependency})
  `);
}
