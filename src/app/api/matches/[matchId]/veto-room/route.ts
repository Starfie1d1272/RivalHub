import { z } from "zod";
import { ok } from "@/types/action";
import { AppError, ErrorCode } from "@/lib/errors";
import { actionError } from "@/lib/action-utils";
import { withRouteObservability } from "@/lib/observability/route";
import { assertVetoRoomReadable } from "@/lib/matches/veto-room/access";
import { getVetoRoomView } from "@/lib/matches/veto-room/read-model";
import { runVetoInteraction, vetoInteractionInput } from "@/lib/matches/veto-room/interaction";

type Context = { params: Promise<{ matchId: string }> };
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const route = "/api/matches/[matchId]/veto-room";

function failure(error: unknown) {
  const result = actionError("vetoRoomHttp", error);
  const code = !result.success ? result.error.code : ErrorCode.INTERNAL_ERROR;
  const status = code === ErrorCode.INTERNAL_ERROR ? 500 : code === ErrorCode.UNAUTHORIZED ? 401 : code === ErrorCode.FORBIDDEN ? 403 : code === ErrorCode.MATCH_NOT_FOUND ? 404 : 400;
  return Response.json(result, { status, headers });
}

export async function GET(request: Request, context: Context) {
  return withRouteObservability(request, route, async () => {
    try {
      const parsed = z.uuid().safeParse((await context.params).matchId);
      if (!parsed.success) throw new AppError(ErrorCode.VALIDATION_FAILED, "比赛编号无效。");
      const access = await assertVetoRoomReadable(parsed.data);
      return Response.json(ok(await getVetoRoomView(parsed.data, access.authorization, access.seasonId)), { headers });
    } catch (error) { return failure(error); }
  }, { captureServerErrorResponse: false });
}

/** Streaming byte limit also covers requests without Content-Length. */
async function readInput(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(ErrorCode.VALIDATION_FAILED, "请求内容无效。");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 5000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (timedOut) throw new AppError(ErrorCode.VALIDATION_FAILED, "读取请求超时。");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) { await reader.cancel(); throw new AppError(ErrorCode.VALIDATION_FAILED, "请求内容过大。"); }
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
    catch { throw new AppError(ErrorCode.VALIDATION_FAILED, "请求内容无效。"); }
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

export async function POST(request: Request, context: Context) {
  return withRouteObservability(request, route, async () => {
    try {
      // Configured public origin is authoritative behind the Linux reverse proxy.
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? (process.env.NODE_ENV !== "production" ? request.url : "");
      let origin: string | null = null;
      try { const url = new URL(appUrl); if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) origin = url.origin; } catch { /* Fail closed. */ }
      if (!origin || request.headers.get("origin") !== origin) throw new AppError(ErrorCode.FORBIDDEN, "请求来源无效。");
      const parsed = vetoInteractionInput.safeParse({ ...await readInput(request) as object, matchId: (await context.params).matchId });
      if (!parsed.success) throw new AppError(ErrorCode.VALIDATION_FAILED, "请求内容无效，请刷新页面后重试。");
      return Response.json(ok(await runVetoInteraction(parsed.data, "route")), { headers });
    } catch (error) { return failure(error); }
  }, { captureServerErrorResponse: false });
}
