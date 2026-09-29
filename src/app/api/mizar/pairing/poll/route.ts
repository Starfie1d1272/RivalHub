import { z } from "zod";
import { pollMizarPairing } from "@/lib/mizar/installation";
import { mizarHttpError, mizarPairingHeaders, readBoundedMizarJson } from "@/lib/mizar/http";

export async function OPTIONS(request: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: mizarPairingHeaders(request) });
}

export async function POST(request: Request): Promise<Response> {
  const headers = mizarPairingHeaders(request);
  try {
    const input = z.strictObject({ pairingId: z.uuid(), pollToken: z.string().regex(/^[0-9a-f]{64}$/) }).parse(await readBoundedMizarJson(request, 1024));
    return Response.json(await pollMizarPairing(input.pairingId, input.pollToken), { headers });
  } catch (error) { const response = mizarHttpError(error); headers.forEach((value, key) => response.headers.set(key, value)); return response; }
}
