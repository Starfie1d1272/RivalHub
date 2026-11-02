import { readFileSync } from 'node:fs';
import { OFFICIAL_PREVIEW, OFFICIAL_PRODUCTION } from '../../src/lib/runtime/official-deployment-profile.mjs';
const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (manifest.environment !== 'instance' || process.env.NODE_ENV !== 'production' || process.env.VERCEL_ENV || process.env.RIVALHUB_E2E_AUTH_BOOTSTRAP) throw Error('Independent instance runtime required.');
if (process.env.HOSTNAME !== '127.0.0.1' || process.env.PORT !== '3033') throw Error('Instance must listen on 127.0.0.1:3033.');
for (const name of ['DATABASE_URL', 'NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_JWT_SECRET', 'CRON_SECRET', 'ADMIN_SESSION_SECRET', 'RIVALHUB_OWNER_EMAIL']) {
  if (!process.env[name] || process.env[name] === '[SENSITIVE]') throw Error(`Missing instance runtime value: ${name}`);
}
if (!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_') || !process.env.SUPABASE_SECRET_KEY.startsWith('sb_secret_')) throw Error('Hosted Supabase publishable and secret keys are required.');
if (process.env.ADMIN_SESSION_SECRET.length < 32) throw Error('ADMIN_SESSION_SECRET must contain at least 32 characters.');
for (const name of ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
  const url = new URL(process.env[name]);
  if (url.protocol !== 'https:' || url.origin !== process.env[name] || url.username || url.password) throw Error(`${name} must be an HTTPS origin.`);
}
if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !process.env.TURNSTILE_SECRET_KEY) throw Error('TURNSTILE_SECRET_KEY required.');

const api = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
const db = new URL(process.env.DATABASE_URL);
const match = /^([a-z]{20})\.supabase\.co$/.exec(api.hostname);
if (!match || [OFFICIAL_PRODUCTION.projectRef, OFFICIAL_PREVIEW.projectRef].includes(match[1]) || process.env.NEXT_PUBLIC_APP_URL === OFFICIAL_PRODUCTION.origin) throw Error('A non-official hosted Supabase instance is required.');
if (!(db.hostname === `db.${match[1]}.supabase.co` || (db.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(db.username) === `postgres.${match[1]}`))) throw Error('Database and API project do not match.');
