import "server-only";
import { AppError } from "@/lib/errors";
import { ZodError } from "zod";
import { ensureRequestId } from "@/lib/observability/context";
import { withRouteObservability } from "@/lib/observability/route";
import { captureException } from "@/lib/observability/server";
import { classifyError } from "@/lib/observability/errors";

type MizarPhase = "auth" | "read" | "validate" | "domain" | "revalidation";
interface MizarDiagnostics { operation: string; phase: MizarPhase; requestId: string; route?: string }

/** One capture owner for handled route failures; LIVE expected outcomes stay quiet. */
export function withMizarRequest(request: Request, route: string, operation: string, handler: (diagnostics: MizarDiagnostics) => Promise<Response>): Promise<Response> {
  return withRouteObservability(request, route, async (requestContext) => {
    const diagnostics: MizarDiagnostics = { operation, phase: "auth", requestId: ensureRequestId(requestContext.requestId), route };
    try {
      return await handler(diagnostics);
    } catch (error) {
      return mizarHttpError(error, diagnostics);
    }
  }, { captureServerErrorResponse: false });
}

class MizarBodyError extends Error {
  constructor(public readonly code: "invalid_body" | "body_timeout" | "payload_too_large") { super(code); }
}

/** Bound bytes while streaming; Content-Length is untrusted. */
export async function readBoundedMizarJson(request: Request, maxBytes: number, timeoutMs?: number): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new MizarBodyError("invalid_body");
  let timedOut = false;
  const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, timeoutMs);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (timedOut) throw new MizarBodyError("body_timeout");
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new MizarBodyError("payload_too_large"); }
      chunks.push(value);
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
    } catch {
      // Malformed JSON/UTF-8 is client input; never retain its parser message/body.
      throw new MizarBodyError("invalid_body");
    }
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

export function mizarHttpError(error: unknown, diagnostics?: MizarDiagnostics) {
  const headers = { "Cache-Control": "no-store" };
  if (error instanceof AppError && error.code !== "INTERNAL_ERROR") {
    const status = error.code === "UNAUTHORIZED" ? 401 : error.code === "FORBIDDEN" ? 403 : ["NOT_FOUND", "MATCH_NOT_FOUND", "SEASON_NOT_FOUND"].includes(error.code) ? 404 : 400;
    return Response.json({ error: error.presentation?.message ?? error.message, code: error.code }, { status, headers });
  }
  if (error instanceof MizarBodyError) {
    const status = error.code === "payload_too_large" ? 413 : error.code === "body_timeout" ? 408 : 400;
    const message = error.code === "payload_too_large" ? "制播数据过大，请更新 Mizar 后重试。" : error.code === "body_timeout" ? "读取制播数据超时，请检查网络后重试。" : "制播数据格式无效，请更新 Mizar 后重试。";
    return Response.json({ error: message, code: error.code }, { status, headers });
  }
  if (error instanceof ZodError && (!diagnostics || diagnostics.phase === "validate" || diagnostics.phase === "domain")) {
    return Response.json({ error: "制播数据格式无效，请刷新比赛资料并更新 Mizar 后重试。", code: "VALIDATION_FAILED" }, { status: 400, headers });
  }
  const requestId = ensureRequestId(diagnostics?.requestId);
  const classification = classifyError(error);
  captureException("mizar.request.failure", error, {
    scope: "mizar", operation: diagnostics?.operation ?? "request", requestId, route: diagnostics?.route,
    errorCode: classification.errorCode ?? "INTERNAL_ERROR",
    safeContext: { phase: diagnostics?.phase ?? "domain", httpStatus: 500 },
  });
  const hint = diagnostics?.phase === "revalidation" ? "数据可能已保存，请先刷新核对结果。" : "请先刷新比赛资料并核对操作结果，稍后重试。";
  return Response.json({ error: `制播连接暂时不可用。${hint}如仍有问题，请向管理员提供排查编号：${requestId}`, code: "INTERNAL_ERROR", requestId }, { status: 500, headers: { ...headers, "X-Request-Id": requestId } });
}

/** Pairing endpoints accept desktop WebView origins but never browser cookies. */
export function mizarPairingHeaders(request: Request): Headers {
  const headers = new Headers({ "Cache-Control": "no-store", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
  const origin = request.headers.get("origin");
  const configured = process.env.MIZAR_ALLOWED_ORIGINS?.split(",").map(value => value.trim()).filter(Boolean) ?? [];
  if (origin && (configured.includes(origin) || origin === "null" || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

export function mizarContextResponse(request: Request, document: { revision: string }) {
  if (new TextEncoder().encode(JSON.stringify(document)).length > 256 * 1024) throw new Error("context_payload_too_large");
  const etag = `"${document.revision}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache", Vary: "Authorization" };
  return request.headers.get("if-none-match") === etag ? new Response(null, { status: 304, headers }) : Response.json(document, { headers });
}
