import { authenticateDakRequest } from "@/lib/demo-integration/pairing";
import { submitRivalHubEvidence } from "@/lib/demo-integration/submit";
import {
  withIntegrationRequest,
  integrationJson,
  integrationOptions,
} from "@/lib/demo-integration/http";
import { AppError, ErrorCode } from "@/lib/errors";
import { BoundedJsonError, readBoundedRequestJson } from "@/lib/integrations/http-body";
import { deliverMatchProjectionInvalidations } from "@/lib/matches/projection-invalidation/delivery";
import { captureException } from "@/lib/observability/server";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export async function OPTIONS(request: Request): Promise<Response> {
  return integrationOptions(request);
}

export async function POST(request: Request): Promise<Response> {
  return withIntegrationRequest(
    request,
    "/api/integrations/dak/evidence",
    "evidence.submit",
    async (diagnostics) => {
      const principal = await authenticateDakRequest(request, "demo:submit");
      diagnostics.phase = "read";
      let input: unknown;
      try {
        input = await readBoundedRequestJson(request, MAX_BODY_BYTES, 30_000);
      } catch (error) {
        if (!(error instanceof BoundedJsonError)) throw error;
        if (error.code === "body_timeout") {
          return integrationJson(
            request,
            { error: { code: "VALIDATION_FAILED", message: "读取 Demo Evidence 请求超时。" } },
            { status: 408 },
          );
        }
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          error.code === "payload_too_large"
            ? "Demo Evidence 请求体超过 5 MB 限制。"
            : "Demo Evidence 必须是 JSON。",
        );
      }
      diagnostics.phase = "domain";
      const { response, pendingMatchId } = await submitRivalHubEvidence({
        input,
        pairingId: principal.pairing.id,
        pairingScope: principal.pairing,
        idempotencyKey: request.headers.get("idempotency-key"),
      });
      diagnostics.phase = "revalidation";
      if (pendingMatchId) {
        try {
          await deliverMatchProjectionInvalidations("route", [pendingMatchId]);
        } catch (error) {
          captureException("demo.evidence.invalidation_pending", error, {
            scope: "demo",
            operation: "evidence.invalidate",
            retryable: true,
          });
        }
      }
      return integrationJson(request, response);
    },
  );
}
