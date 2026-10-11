import { pollDakPairing } from "@/lib/demo-integration/pairing";
import { withIntegrationRequest, integrationJson, integrationOptions } from "@/lib/demo-integration/http";
import { AppError, ErrorCode } from "@/lib/errors";

export async function OPTIONS(request: Request): Promise<Response> {
  return integrationOptions(request);
}

export async function POST(request: Request): Promise<Response> {
  return withIntegrationRequest(request, "/api/integrations/dak/pairing/poll", "pairing.poll", async (diagnostics) => {
    diagnostics.phase = "read";
    const body = await request.json().catch(() => null) as { pairingId?: unknown; pollToken?: unknown } | null;
    diagnostics.phase = "validate";
    const pairingId = typeof body?.pairingId === "string" ? body.pairingId.trim() : "";
    const pollToken = typeof body?.pollToken === "string" ? body.pollToken.trim() : "";
    if (!pairingId || !pollToken) throw new AppError(ErrorCode.VALIDATION_FAILED, "连接请求参数不完整。");
    diagnostics.phase = "domain";
    return integrationJson(request, await pollDakPairing(pairingId, pollToken));
  });
}
