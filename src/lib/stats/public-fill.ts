import "server-only";

import { withDbTrafficSource, type DbTrafficSource } from "@/lib/observability/db-traffic";
import { beginRuntimeResource } from "@/lib/observability/runtime-resources";

/** Call inside the public cache callback, never around a cache lookup. */
export async function observePublicStatsFill<T>(source: Extract<DbTrafficSource, `stats.${string}`>, read: () => Promise<T>): Promise<T> {
  const done = beginRuntimeResource("stats.public.fill");
  try {
    return await withDbTrafficSource(source, read);
  } finally {
    done();
  }
}
