/**
 * Application seed entrypoint.
 *
 * Administrator ownership is bootstrapped by the normal Supabase Auth owner
 * flow; local fixtures are maintained separately by seed-local-fixtures.ts.
 */
import { logEvent } from "../lib/observability/logger";

export async function seed(): Promise<void> {
  logEvent({
    level: "info",
    event: "seed.no_application_rows",
    scope: "database",
    operation: "seed",
    message: "No application seed rows configured.",
  });
}
