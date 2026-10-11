import { z } from "zod";
import { pollMizarPairing } from "@/lib/mizar/installation";
import { withMizarRequest, mizarPairingHeaders, readBoundedMizarJson } from "@/lib/mizar/http";

export async function OPTIONS(request: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: mizarPairingHeaders(request) });
}

export async function POST(request: Request): Promise<Response> {
  const headers = mizarPairingHeaders(request);
  const response = await withMizarRequest(request, "/api/mizar/pairing/poll", "pairing.poll", async (diagnostics) => {
    diagnostics.phase = "read";
    const body = await readBoundedMizarJson(request, 1024);
    diagnostics.phase = "validate";
    const input = z.strictObject({ pairingId: z.uuid(), pollToken: z.string().regex(/^[0-9a-f]{64}$/) }).parse(body);
    diagnostics.phase = "domain";
    return Response.json(await pollMizarPairing(input.pairingId, input.pollToken), { headers });
  });
  headers.forEach((value, key) => response.headers.set(key, value));
  return response;
}
