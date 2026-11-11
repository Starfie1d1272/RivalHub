import "server-only";

export class BoundedJsonError extends Error {
  constructor(public readonly code: "invalid_body" | "body_timeout" | "payload_too_large") {
    super(code);
  }
}

/** Bound bytes while streaming; Content-Length is untrusted. */
export async function readBoundedRequestJson(
  request: Request,
  maxBytes: number,
  timeoutMs?: number,
): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new BoundedJsonError("invalid_body");
  let timedOut = false;
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          void reader.cancel().catch(() => {});
        }, timeoutMs);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (timedOut) throw new BoundedJsonError("body_timeout");
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new BoundedJsonError("payload_too_large");
      }
      chunks.push(value);
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
    } catch {
      // Malformed JSON/UTF-8 is client input; never retain its parser message/body.
      throw new BoundedJsonError("invalid_body");
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
