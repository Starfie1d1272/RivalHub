// Pure environment contract shared by the server-only facade and Node DB adapter.
import { AppError, ErrorCode } from "../errors";

export const PREVIEW_PROJECT_REF = "cueazphyskstwdhnzsxx";
export const PREVIEW_READONLY_MESSAGE = "预览镜像仅供浏览，此操作不可用。";

export function isPreview(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === "preview";
}

export function assertPreviewMutationAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (isPreview(env)) throw new AppError(ErrorCode.FORBIDDEN, PREVIEW_READONLY_MESSAGE);
}

export function assertPreviewDatabaseUrl(value: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!isPreview(env)) return;
  const url = new URL(value);
  if (url.hostname !== "aws-0-ap-northeast-1.pooler.supabase.com"
    || url.port !== "6543" || url.pathname !== "/postgres"
    || decodeURIComponent(url.username) !== `rivalhub_preview_ro.${PREVIEW_PROJECT_REF}`
    || !url.password || url.searchParams.get("pgbouncer") !== "true") {
    throw new Error("Preview 必须使用固定 dev project 的 SELECT-only role。");
  }
}

export function assertPreviewAuthEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (!isPreview(env)) return;
  if (env.NEXT_PUBLIC_SUPABASE_URL !== `https://${PREVIEW_PROJECT_REF}.supabase.co`
    || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY
    || env.NEXT_PUBLIC_RIVALHUB_PREVIEW_READONLY !== "1"
    || env.RIVALHUB_PREVIEW_MIRROR_MODE !== "production-derived") {
    throw new Error("Preview Auth 只允许 dev public credential，不允许 privileged key。");
  }
}
