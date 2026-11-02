// Compare destination identity, never credentials. A direct endpoint and either
// pooler mode for the same project/database identify the same database.
const api = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
const db = new URL(process.env.DATABASE_URL ?? '');
const project = /^([a-z]{20})\.supabase\.co$/.exec(api.hostname)?.[1];
if (!project || api.protocol !== 'https:' || api.origin !== process.env.NEXT_PUBLIC_SUPABASE_URL
  || api.username || api.password || !['postgres:', 'postgresql:'].includes(db.protocol)
  || db.hash) throw Error('Instance database identity is invalid.');
const direct = db.hostname === `db.${project}.supabase.co` && (!db.port || db.port === '5432');
const pooled = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(db.hostname)
  && decodeURIComponent(db.username) === `postgres.${project}` && ['', '5432', '6543'].includes(db.port);
if (!direct && !pooled) throw Error('Database endpoint does not match the instance project.');
// libpq parameters can override the URL destination; refuse unrecognised or
// duplicate options instead of comparing one identity and connecting to another.
const seen = new Set();
for (const [key] of db.searchParams) {
  if (!['sslmode', 'pgbouncer'].includes(key) || seen.has(key)) throw Error('Unsupported database URL option for instance identity.');
  seen.add(key);
}
const database = decodeURIComponent(db.pathname.slice(1));
if (!database || database.includes('/') || database.includes('\0')) throw Error('Instance database name is invalid.');
console.log(JSON.stringify({ project, database }));
