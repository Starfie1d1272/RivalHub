import { authenticateDakRequest } from "@/lib/demo-integration/pairing";
import { submitRivalHubEvidence } from "@/lib/demo-integration/submit";
import { integrationError, integrationJson, integrationOptions } from "@/lib/demo-integration/http";
import { AppError, ErrorCode } from "@/lib/errors";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function OPTIONS(request: Request): Promise<Response> {
  return integrationOptions(request);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await authenticateDakRequest(request, "demo:submit");
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new AppError(ErrorCode.VALIDATION_FAILED, "Demo Evidence 请求体超过 5 MB 限制。");
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "Demo Evidence 必须是 JSON。");
    }
    return integrationJson(request, await submitRivalHubEvidence({
      input,
      pairingId: principal.pairing.id,
      idempotencyKey: request.headers.get("idempotency-key"),
    }));
  } catch (error) {
    return integrationError(request, error);
  }
}
