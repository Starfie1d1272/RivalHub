import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db/client";
import { PUBLIC_COMPETITIVE_CATALOG_TAG } from "@/lib/cache/tags";
import { loadCompetitivePlatformCatalog } from "./catalog";

/** Viewer-independent presentation only; validation/freezing keep their transaction loader. */
export async function getPublicCompetitiveCatalog() {
  "use cache: remote";
  cacheLife({ stale: 60, revalidate: 3600, expire: 86400 });
  cacheTag(PUBLIC_COMPETITIVE_CATALOG_TAG);
  return loadCompetitivePlatformCatalog(db);
}
