import { pollDakPairing } from "@/lib/demo-integration/pairing";
import { integrationError, integrationJson, integrationOptions } from "@/lib/demo-integration/http";
import { AppError, ErrorCode } from "@/lib/errors";

export async function OPTIONS(request: Request): Promise<Response> {
  return integrationOptions(request);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => null) as { pairingId?: unknown; pollToken?: unknown } | null;
    const pairingId = typeof body?.pairingId === "string" ? body.pairingId.trim() : "";
    const pollToken = typeof body?.pollToken === "string" ? body.pollToken.trim() : "";
    if (!pairingId || !pollToken) throw new AppError(ErrorCode.VALIDATION_FAILED, "连接请求参数不完整。");
    return integrationJson(request, await pollDakPairing(pairingId, pollToken));
  } catch (error) {
    return integrationError(request, error);
  }
}
