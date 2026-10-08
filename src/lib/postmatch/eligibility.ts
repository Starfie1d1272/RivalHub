import "server-only";
import { sql } from "drizzle-orm";
import { seasonAdminGrants, users } from "@/db/schema";

/** Apply to a query over users; a global admin or this season's grant can be an actual caster. */
export function commentaryAdminEligibility(seasonId: string) {
  return sql<boolean>`(${users.role} = 'super_admin' OR EXISTS (
    SELECT 1 FROM ${seasonAdminGrants}
    WHERE ${seasonAdminGrants.userId} = ${users.id}
      AND ${seasonAdminGrants.seasonId} = ${seasonId}
  ))`;
}
