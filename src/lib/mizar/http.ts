import "server-only";
import { AppError } from "@/lib/errors";

/** Bound bytes while streaming; Content-Length is untrusted. */
export async function readBoundedMizarJson(request: Request, maxBytes: number, timeoutMs?: number): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_body");
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
      if (timedOut) throw new Error("body_timeout");
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("payload_too_large"); }
      chunks.push(value);
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

export function mizarHttpError(error: unknown) {
  return Response.json({ error: error instanceof AppError && error.code !== "INTERNAL_ERROR" ? error.message : "制播连接暂时不可用，请稍后重试。" }, { status: error instanceof AppError && error.code === "UNAUTHORIZED" ? 401 : error instanceof AppError && error.code === "FORBIDDEN" ? 403 : 400, headers: { "Cache-Control": "no-store" } });
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
