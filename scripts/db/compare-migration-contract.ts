import { Pool } from "pg";
import { assertLocalDatabaseUrl } from "./local-environment";
import { REALTIME_VIEWER_POLICY_FILTER } from "./realtime-policy";

// Compare only schema-owned metadata, never business rows or provider-internal
// schemas. Both databases must use the same PostgreSQL/provider version.
const queries: Record<string, string> = {
  version: `SELECT current_setting('server_version_num') AS version`,
  schemas: `SELECT nspname, pg_get_userbyid(nspowner) AS owner, nspacl::text FROM pg_namespace WHERE nspname='public'`,
  extensions: `SELECT e.extname, e.extversion, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace`,
  relations: `SELECT c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relreplident,
    pg_get_userbyid(c.relowner) AS owner, c.relacl::text, c.reloptions, obj_description(c.oid, 'pg_class') AS comment,
    CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid, true) END AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')`,
  columns: `SELECT c.relname, a.attname, a.attnum, format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull, a.attidentity, a.attgenerated, a.attacl::text, pg_get_expr(d.adbin,d.adrelid) AS default_value,
    col_description(c.oid,a.attnum) AS comment
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped`,
  constraints: `SELECT c.relname, x.conname, x.contype, x.convalidated, pg_get_constraintdef(x.oid, true) AS definition
    FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'`,
  indexes: `SELECT t.relname AS relation, i.relname AS name, x.indisvalid, x.indisready, pg_get_indexdef(i.oid) AS definition
    FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'`,
  types: `SELECT t.typname, t.typtype, t.typcategory, pg_get_userbyid(t.typowner) AS owner, t.typacl::text,
    COALESCE((SELECT json_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid), '[]'::json) AS labels,
    CASE WHEN t.typtype='d' THEN format_type(t.typbasetype,t.typtypmod) END AS base_type,
    t.typnotnull, t.typdefault
    FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype IN ('e','d')`,
  routines: `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments, p.prokind,
    pg_get_userbyid(p.proowner) AS owner, p.proacl::text, pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p','w')`,
  triggers: `SELECT c.relname, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid, true) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal`,
  constraint_triggers: `SELECT owner.relname AS constraint_table, con.conname, event_ns.nspname AS event_schema,
    event_table.relname AS event_table, t.tgtype, p.proname AS function_name, t.tgenabled
    FROM pg_trigger t JOIN pg_constraint con ON con.oid=t.tgconstraint
    JOIN pg_class owner ON owner.oid=con.conrelid JOIN pg_namespace owner_ns ON owner_ns.oid=owner.relnamespace
    JOIN pg_class event_table ON event_table.oid=t.tgrelid JOIN pg_namespace event_ns ON event_ns.oid=event_table.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgisinternal AND owner_ns.nspname='public'`,
  policies: `SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies
    WHERE schemaname IN ('public','storage') OR (schemaname='realtime' AND tablename='messages' AND ${REALTIME_VIEWER_POLICY_FILTER})`,
  realtime_messages: `SELECT c.relkind, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='realtime' AND c.relname='messages'`,
  sequences: `SELECT schemaname, sequencename, data_type, start_value, min_value, max_value, increment_by, cycle, cache_size FROM pg_sequences WHERE schemaname='public'`,
  publication_options: `SELECT pubname, puballtables, pubinsert, pubupdate, pubdelete, pubtruncate, pubviaroot FROM pg_publication`,
  publications: `SELECT pubname, schemaname, tablename, attnames, rowfilter FROM pg_publication_tables WHERE schemaname='public'`,
  default_privileges: `SELECT pg_get_userbyid(d.defaclrole) AS owner, n.nspname, d.defaclobjtype, d.defaclacl::text
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
    WHERE n.nspname='public' OR (d.defaclnamespace=0 AND d.defaclrole IN (
      SELECT nspowner FROM pg_namespace WHERE nspname='public'
      UNION SELECT c.relowner FROM pg_class c JOIN pg_namespace p ON p.oid=c.relnamespace WHERE p.nspname='public'
      UNION SELECT f.proowner FROM pg_proc f JOIN pg_namespace p ON p.oid=f.pronamespace WHERE p.nspname='public'
      UNION SELECT t.typowner FROM pg_type t JOIN pg_namespace p ON p.oid=t.typnamespace WHERE p.nspname='public'
    ))`,
};

async function snapshot(url: string): Promise<Record<string, string[]>> {
  const pool = new Pool({ connectionString: url, ssl: false, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result: Record<string, string[]> = {};
    for (const [name, query] of Object.entries(queries)) {
      result[name] = (await client.query(query)).rows.map(row => JSON.stringify(row)).sort();
    }
    const storage = await client.query<{ buckets: string | null }>("SELECT to_regclass('storage.buckets')::text AS buckets");
    result.storage_presence = [String(Boolean(storage.rows[0]?.buckets))];
    if (storage.rows[0]?.buckets) {
      const buckets = await client.query(`SELECT id, name, public, file_size_limit, allowed_mime_types
        FROM storage.buckets WHERE id IN ('team-logos','season-public-assets','education-evidence')`);
      result.buckets = buckets.rows.map(row => JSON.stringify(row)).sort();
    }
    await client.query("ROLLBACK");
    return result;
  } finally {
    client.release();
    await pool.end();
  }
}

/** Supplemental isolated evidence, not an authorization to adopt a database. */
export async function compareMigrationContracts(left: string | undefined, right: string | undefined): Promise<void> {
  const a = assertLocalDatabaseUrl(left, "RIVALHUB_COMPARE_LEFT_DATABASE_URL");
  const b = assertLocalDatabaseUrl(right, "RIVALHUB_COMPARE_RIGHT_DATABASE_URL");
  const leftUrl = new URL(a), rightUrl = new URL(b);
  if (leftUrl.search || rightUrl.search || leftUrl.hash || rightUrl.hash) {
    throw new Error("Contract comparison database URLs must not contain query parameters or fragments.");
  }
  if (leftUrl.pathname === rightUrl.pathname && (leftUrl.port || "5432") === (rightUrl.port || "5432")) {
    throw new Error("Contract comparison requires two distinct isolated databases.");
  }
  const [before, after] = await Promise.all([snapshot(a), snapshot(b)]);
  const differing = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(name => JSON.stringify(before[name]) !== JSON.stringify(after[name]));
  if (differing.length) throw new Error(`Migration contract differs in: ${differing.join(', ')}.`);
  console.log("Isolated migration schema contract comparison passed; application catalog rows and business data require separate verification.");
}
