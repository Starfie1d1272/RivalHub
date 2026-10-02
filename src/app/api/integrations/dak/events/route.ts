import { authenticateDakRequest } from "@/lib/demo-integration/pairing";
import { readRivalHubEvents } from "@/lib/demo-integration/read";
import { integrationError, integrationJson, integrationOptions } from "@/lib/demo-integration/http";

export async function OPTIONS(request: Request): Promise<Response> {
  return integrationOptions(request);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await authenticateDakRequest(request, "event:read");
    // Published clients use strict schemas, so the default wire shape stays v1.
    const includeSeriesDisposition = new URL(request.url).searchParams.get("seriesDisposition") === "1";
    return integrationJson(request, await readRivalHubEvents(principal.pairing, { includeSeriesDisposition }));
  } catch (error) {
    return integrationError(request, error);
  }
}
