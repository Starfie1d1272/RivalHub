import { z } from "zod";
import { issueLiveViewerToken } from "@/lib/mizar/live";
import { mizarHttpError } from "@/lib/mizar/http";

export async function GET(_request: Request, context: { params: Promise<{ matchId: string }> }) {
  try {
    const { matchId } = await context.params;
    return Response.json(await issueLiveViewerToken(z.uuid().parse(matchId)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mizarHttpError(error); }
}
