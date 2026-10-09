import "server-only";
import { sql } from "drizzle-orm";
import { matches, matchTimeProposals } from "@/db/schema";

/** Preserve the proposing entry independently of representative handovers.
 * Legacy rows use existing immutable history; missing provenance fails closed.
 * Callers join matches. This identity stays out of the public proposal DTO. */
export function proposingEntryId() {
  return sql<string | null>`coalesce(${matchTimeProposals.proposedByEntryId}, (
    select entry.id from competition_entries entry
    where entry.id in (${matches.entryAId}, ${matches.entryBId})
      and (
        select change.to_user_id from competition_entry_representative_changes change
        where change.entry_id = entry.id and change.changed_at <= ${matchTimeProposals.createdAt}
        order by change.changed_at desc, change.id desc limit 1
      ) = ${matchTimeProposals.proposedBy}
    limit 1
  ))`;
}
