import "server-only";

import { randomUUID } from "node:crypto";
import { ErrorCode } from "@/lib/errors";
import type { ActionError } from "@/types/action";
import type { OCRDiagnostic } from "./diagnostics";

type OCRFailureKind = "configuration" | "authentication" | "rate_limit" | "network" | "timeout" | "upstream" | "image";
type OCRPhase = "configuration" | "image" | "request" | "response" | "json_parse" | "shape";

const MESSAGES: Record<OCRFailureKind, string> = {
  configuration: "OCR 服务配置不完整，请联系超级管理员检查系统状态中的 OCR 配置。",
  authentication: "OCR 上游鉴权失败，请联系超级管理员检查环境绑定、凭据和上游账号权限。",
  rate_limit: "OCR 上游限流或额度不足，请稍后重试；持续失败时请管理员检查上游账号额度。",
  network: "OCR 服务无法连接上游，请稍后重试；持续失败时请管理员检查网络连接。",
  timeout: "OCR 上游请求超时，请稍后重试。",
  upstream: "OCR 上游服务或返回结果异常，请稍后重试；持续失败时请联系管理员。",
  image: "截图无法读取，请选择有效的 JPEG、PNG 或 WebP 图片（不超过 10MB）后重试。",
};

/**
 * reason/cause/errorChain contain fixed classification codes and synthetic errors.
 * diagnostics separately preserve real provider/transport name, code, message and
 * cause projections after bounded extraction and redaction; retain those reasons.
 * Neither raw exceptions nor provider responses belong in this object.
 */
export class OCRFailure extends Error {
  readonly requestId: string;
  readonly retryable: boolean;
  readonly errorChain: string[];
  readonly diagnostics: readonly OCRDiagnostic[];

  constructor(
    readonly kind: OCRFailureKind,
    readonly phase: OCRPhase,
    readonly reason: string,
    readonly httpStatus?: number,
    options?: { requestId?: string; cause?: Error; diagnostics?: readonly OCRDiagnostic[] },
  ) {
    super(`ocr.${phase}.${reason}`, { cause: options?.cause });
    this.name = "OCRFailure";
    this.requestId = options?.requestId ?? randomUUID();
    this.retryable = ["rate_limit", "network", "timeout", "upstream"].includes(kind);
    this.diagnostics = (options?.diagnostics ?? []).slice(0, 8);
    this.errorChain = [this.message];
    let cause = options?.cause;
    while (cause && this.errorChain.length < 4) {
      this.errorChain.push(cause.message);
      cause = cause.cause instanceof Error ? cause.cause : undefined;
    }
  }
}

export function presentOCRFailure(error: OCRFailure): ActionError {
  return {
    code: error.kind === "image" ? ErrorCode.VALIDATION_FAILED : ErrorCode.OCR_UNAVAILABLE,
    message: MESSAGES[error.kind] + (error.httpStatus ? `（HTTP ${error.httpStatus}）` : ""),
    meta: {
      requestId: error.requestId,
      configurationRequired: error.kind === "configuration" || error.kind === "authentication",
    },
  };
}
