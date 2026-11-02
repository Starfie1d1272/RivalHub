/** Non-sensitive source facts checked against the running process configuration. */
export function readInstanceRecoverySource(apiValue: string | undefined, databaseValue: string | undefined, allowLocal = false): { supabaseUrl: string; databaseName: string } {
  let api: URL, db: URL;
  try { api = new URL(apiValue ?? ""); db = new URL(databaseValue ?? ""); }
  catch { throw new Error("Instance recovery source identity invalid."); }
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (allowLocal && api.protocol === "http:" && api.origin === apiValue && !api.username && !api.password
    && loopback.has(api.hostname) && loopback.has(db.hostname) && ["postgres:", "postgresql:"].includes(db.protocol)
    && db.pathname === "/postgres" && !db.hash && ![...db.searchParams.keys()].some(key => key !== "sslmode")) {
    return { supabaseUrl: api.origin, databaseName: "postgres" };
  }
  const project = /^([a-z]{20})\.supabase\.co$/.exec(api.hostname)?.[1];
  if (!project || api.protocol !== "https:" || api.origin !== apiValue || api.username || api.password
    || !["postgres:", "postgresql:"].includes(db.protocol) || db.pathname !== "/postgres" || db.hash) {
    throw new Error("Instance recovery source identity invalid.");
  }
  const direct = db.hostname === `db.${project}.supabase.co` && (!db.port || db.port === "5432");
  const pooled = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(db.hostname)
    && decodeURIComponent(db.username) === `postgres.${project}` && ["", "5432", "6543"].includes(db.port);
  if ((!direct && !pooled) || [...db.searchParams.keys()].some(key => key !== "sslmode" && key !== "pgbouncer")) {
    throw new Error("Instance recovery source database does not match public configuration.");
  }
  return { supabaseUrl: api.origin, databaseName: "postgres" };
}
