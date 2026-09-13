import { authenticateDakRequest } from "@/lib/demo-integration/pairing";
import { readRivalHubEvents } from "@/lib/demo-integration/read";
import { integrationError, integrationJson, integrationOptions } from "@/lib/demo-integration/http";

export async function OPTIONS(request: Request): Promise<Response> {
  return integrationOptions(request);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await authenticateDakRequest(request, "event:read");
    return integrationJson(request, await readRivalHubEvents(principal.pairing));
  } catch (error) {
    return integrationError(request, error);
  }
}
