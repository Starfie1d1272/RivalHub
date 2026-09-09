import "server-only";

import { createServiceClient } from "@/lib/auth/supabase-server";
import { AppError, ErrorCode } from "@/lib/errors";
import { logEvent } from "@/lib/observability/server";
import {
  EDUCATION_EVIDENCE_SIGNED_URL_TTL_SECONDS,
  type EducationEvidenceMimeType,
} from "./validation";

export const EDUCATION_EVIDENCE_BUCKET = "education-evidence";

const STORAGE_FAILURE_MESSAGE = "教育材料存储服务暂时不可用，请稍后重试。";

/** The only server-side owner of the private education-evidence bucket. */
export const educationEvidenceStorage = {
  async upload(key: string, file: File, contentType: EducationEvidenceMimeType): Promise<void> {
    try {
      const { error } = await createServiceClient()
        .storage
        .from(EDUCATION_EVIDENCE_BUCKET)
        .upload(key, file, { upsert: false, contentType });
      if (error) throw error;
    } catch (error) {
      reportStorageFailure("upload", error);
      throw new AppError(ErrorCode.INTERNAL_ERROR, STORAGE_FAILURE_MESSAGE);
    }
  },

  async remove(key: string): Promise<void> {
    try {
      const { error } = await createServiceClient()
        .storage
        .from(EDUCATION_EVIDENCE_BUCKET)
        .remove([key]);
      if (error && !isMissingObjectError(error)) throw error;
    } catch (error) {
      if (isMissingObjectError(error)) return;
      reportStorageFailure("remove", error);
      throw new AppError(ErrorCode.INTERNAL_ERROR, STORAGE_FAILURE_MESSAGE);
    }
  },

  async createSignedUrl(key: string): Promise<string> {
    try {
      const { data, error } = await createServiceClient()
        .storage
        .from(EDUCATION_EVIDENCE_BUCKET)
        .createSignedUrl(key, EDUCATION_EVIDENCE_SIGNED_URL_TTL_SECONDS);
      if (error || !data?.signedUrl) throw error ?? new Error("missing signed URL");
      return data.signedUrl;
    } catch (error) {
      reportStorageFailure("signed_url", error);
      throw new AppError(ErrorCode.INTERNAL_ERROR, STORAGE_FAILURE_MESSAGE);
    }
  },
};

function reportStorageFailure(operation: "upload" | "remove" | "signed_url", error: unknown): void {
  // Deliberately omit the object key, file name, provider error, and URL. The
  // provider adapter has already converted the dependency failure into a safe
  // application error for its caller.
  void error;
  logEvent({
    level: "error",
    event: "education.evidence_storage.failure",
    scope: "education",
    operation,
    errorClass: "dependency",
    retryable: true,
    safeContext: { provider: "supabase", bucket: EDUCATION_EVIDENCE_BUCKET },
  });
}

function isMissingObjectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  return candidate.status === 404
    || candidate.statusCode === "404"
    || candidate.code === "NoSuchKey"
    || candidate.code === "NotFound";
}
