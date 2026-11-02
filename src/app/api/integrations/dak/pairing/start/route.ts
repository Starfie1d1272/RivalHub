import { requireApplicationOrigin } from "@/lib/runtime/public-config";
import { startDakPairing } from "@/lib/demo-integration/pairing";
import { withIntegrationRequest, integrationJson, integrationOptions } from "@/lib/demo-integration/http";

export async function OPTIONS(request: Request): Promise<Response> {
  return integrationOptions(request);
}

export async function POST(request: Request): Promise<Response> {
  return withIntegrationRequest(request, "/api/integrations/dak/pairing/start", "pairing.start", async (diagnostics) => {
    const origin = requireApplicationOrigin();
    diagnostics.phase = "domain";
    return integrationJson(request, await startDakPairing(origin), { status: 201 });
  });
}
