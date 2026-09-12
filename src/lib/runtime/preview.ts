// Pure environment contract shared by the server-only facade and Node DB adapter.
export const PREVIEW_PROJECT_REF = "cueazphyskstwdhnzsxx";
const PREVIEW_POOLER_HOST = "aws-0-ap-northeast-1.pooler.supabase.com";

export function isPreview(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === "preview";
}

export function assertPreviewDatabaseUrl(value: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!isPreview(env)) return;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Preview DATABASE_URL 格式无效。"); }
  if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    || url.hostname !== PREVIEW_POOLER_HOST || url.port !== "6543" || url.pathname !== "/postgres"
    || decodeURIComponent(url.username) !== `postgres.${PREVIEW_PROJECT_REF}`
    || !url.password || url.searchParams.get("pgbouncer") !== "true") {
    throw new Error("Preview DATABASE_URL 必须使用固定 rivalhub-dev Transaction Pooler。");
  }
}

export function assertPreviewAuthEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (!isPreview(env)) return;
  if (env.NEXT_PUBLIC_SUPABASE_URL !== `https://${PREVIEW_PROJECT_REF}.supabase.co`
    || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || !env.SUPABASE_SERVICE_ROLE_KEY
    || !env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET.length < 32
    || env.SUPABASE_SECRET_KEY) {
    throw new Error("Preview 必须配置 dev Supabase URL/anon/service credential 与独立 ADMIN_SESSION_SECRET。");
  }
}
