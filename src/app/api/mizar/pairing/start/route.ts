import { startMizarPairing } from "@/lib/mizar/installation";
import { mizarHttpError, mizarPairingHeaders } from "@/lib/mizar/http";

/** No browser session is accepted here; the poll secret stays in Mizar. */
export async function OPTIONS(request: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: mizarPairingHeaders(request) });
}

export async function POST(request: Request): Promise<Response> {
  const headers = mizarPairingHeaders(request);
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? "https://match.starfie1d.top";
    return Response.json(await startMizarPairing(origin), { status: 201, headers });
  } catch (error) { const response = mizarHttpError(error); headers.forEach((value, key) => response.headers.set(key, value)); return response; }
}
