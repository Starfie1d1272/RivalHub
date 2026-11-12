import "server-only";

import { eq, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db/client";
import { steamProfiles, users } from "@/db/schema";
import { PUBLIC_STATS_PLAYER_NAMES_TAG } from "@/lib/cache/tags";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { preservePublicStatsDependencyFailure } from "./availability";

async function readPlayerNames(ids: string[]) {
  "use cache: remote";
  cacheLife({ stale: 60, revalidate: Infinity, expire: Infinity });
  cacheTag(PUBLIC_STATS_PLAYER_NAMES_TAG);
  return preservePublicStatsDependencyFailure(async () => {
    const rows = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        perfectName: users.perfectName,
        personaName: steamProfiles.personaName,
      })
      .from(users)
      .leftJoin(steamProfiles, eq(users.steam64, steamProfiles.steam64))
      .where(sql`${users.id} = ANY(${sql.param(ids)}::uuid[])`);
    return Object.fromEntries(rows.map((row) => [row.id, getPublicDisplayName(row)]));
  });
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Public DTOs carry stable IDs next to their display fields. Relabel only those fields. */
function visitPlayerLabels(
  value: unknown,
  field: string,
  label: (id: string, current: string) => string,
): unknown {
  if (Array.isArray(value)) {
    const mapped = value.map((item) => visitPlayerLabels(item, field, label));
    return mapped.some((item, index) => item !== value[index]) ? mapped : value;
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return value;
  const row = value as Record<string, unknown>;
  let copy: Record<string, unknown> | undefined;
  function replace(key: string, next: unknown) {
    if (next !== row[key]) (copy ??= { ...row })[key] = next;
  }
  function relabel(key: string, id: unknown) {
    const name = row[key];
    if (typeof id === "string" && uuid.test(id) && typeof name === "string")
      replace(key, label(id, name));
  }
  if (field === "player" || field === "topPlayer") relabel("displayName", row.entityKey);
  relabel("perfectName", row.userId);
  if (row.entryId === null) relabel("name", row.userId);
  if (typeof row.href === "string" && row.href.startsWith("/players/")) relabel("name", row.id);
  if (
    (typeof row.entityHref === "string" && row.entityHref.startsWith("/players/")) ||
    "victimName" in row
  )
    relabel("entityName", row.entityId ?? row.entityKey);
  relabel("victimName", row.victimId);
  for (const [key, item] of Object.entries(row)) {
    if (item !== null && typeof item === "object")
      replace(key, visitPlayerLabels(item, key, label));
  }
  return copy ?? row;
}

export async function withPublicPlayerLabels<T>(value: T): Promise<T> {
  const ids = new Set<string>();
  visitPlayerLabels(value, "", (id, name) => {
    ids.add(id);
    return name;
  });
  if (!ids.size) return value;
  const names = await readPlayerNames([...ids].sort());
  return visitPlayerLabels(value, "", (id, name) => names[id] ?? name) as T;
}
