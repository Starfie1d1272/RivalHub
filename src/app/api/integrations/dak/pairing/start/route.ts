import { startDakPairing } from "@/lib/demo-integration/pairing";
import { integrationError, integrationJson, integrationOptions } from "@/lib/demo-integration/http";

export async function OPTIONS(request: Request): Promise<Response> {
  return integrationOptions(request);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    return integrationJson(request, await startDakPairing(origin), { status: 201 });
  } catch (error) {
    return integrationError(request, error);
  }
}
