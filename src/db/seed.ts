/**
 * Application seed entrypoint.
 *
 * Administrator ownership is bootstrapped by the normal Supabase Auth owner
 * flow; local fixtures are maintained separately by seed-local-fixtures.ts.
 */
export async function seed(): Promise<void> {
  console.log("No application seed rows configured.");
}
