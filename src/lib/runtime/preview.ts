import { OFFICIAL_PREVIEW } from "./official-deployment-profile.mjs";

// Pure environment contract shared by the server-only facade and Node DB adapter.
export const PREVIEW_PROJECT_REF = OFFICIAL_PREVIEW.projectRef;

export function isPreview(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === "preview";
}

export function assertPreviewDatabaseUrl(value: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!isPreview(env)) return;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Preview DATABASE_URL 格式无效。"); }
  if ((url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    || url.hostname !== OFFICIAL_PREVIEW.poolerHost || url.port !== OFFICIAL_PREVIEW.poolerPort || url.pathname !== "/postgres"
    || decodeURIComponent(url.username) !== `postgres.${PREVIEW_PROJECT_REF}`
    || !url.password || url.searchParams.get("pgbouncer") !== "true") {
    throw new Error("Preview DATABASE_URL 必须使用固定 rivalhub-dev Transaction Pooler。");
  }
}

export function assertPreviewAuthEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (!isPreview(env)) return;
  if (env.NEXT_PUBLIC_SUPABASE_URL !== OFFICIAL_PREVIEW.supabaseUrl
    || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_")
    || !env.SUPABASE_SECRET_KEY?.startsWith("sb_secret_")
    || !env.ADMIN_SESSION_SECRET || env.ADMIN_SESSION_SECRET.length < 32) {
    throw new Error("Preview 必须配置 dev Supabase URL/publishable/secret credential与独立 ADMIN_SESSION_SECRET。");
  }
}
