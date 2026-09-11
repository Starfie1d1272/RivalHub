import "server-only";

import { createServiceClient } from "@/lib/auth/supabase-server";
import { AppError, ErrorCode } from "@/lib/errors";
import { logEvent } from "@/lib/observability/server";
import { SEASON_PUBLIC_ASSETS_BUCKET } from "./presentation";

const STORAGE_FAILURE_MESSAGE = "赛事公开图片存储暂时不可用，请稍后重试。";

export const seasonPublicAssetsStorage = {
  async upload(path: string, file: File, contentType: string): Promise<void> {
    try {
      const { error } = await createServiceClient().storage.from(SEASON_PUBLIC_ASSETS_BUCKET).upload(path, file, { upsert: false, contentType });
      if (error) throw error;
    } catch (error) {
      reportStorageFailure("upload", error);
      throw new AppError(ErrorCode.INTERNAL_ERROR, STORAGE_FAILURE_MESSAGE);
    }
  },
  async remove(path: string): Promise<void> {
    try {
      const { error } = await createServiceClient().storage.from(SEASON_PUBLIC_ASSETS_BUCKET).remove([path]);
      if (error && !isMissingObjectError(error)) throw error;
    } catch (error) {
      if (isMissingObjectError(error)) return;
      reportStorageFailure("remove", error);
      throw new AppError(ErrorCode.INTERNAL_ERROR, STORAGE_FAILURE_MESSAGE);
    }
  },
};

function reportStorageFailure(operation: "upload" | "remove", error: unknown): void {
  void error;
  logEvent({ level: "error", event: "season_public_assets_storage.failure", scope: "season_public_info", operation, errorClass: "dependency", retryable: true, safeContext: { provider: "supabase", bucket: SEASON_PUBLIC_ASSETS_BUCKET } });
}

function isMissingObjectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  return candidate.status === 404 || candidate.statusCode === "404" || candidate.code === "NoSuchKey" || candidate.code === "NotFound";
}
