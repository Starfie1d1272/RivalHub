import { z } from "zod";
import { issueLiveViewerToken } from "@/lib/mizar/live";
import { mizarHttpError } from "@/lib/mizar/http";
import { getOpaqueSessionCachePartition } from "@/lib/auth/session";

export async function GET(_request: Request, context: { params: Promise<{ matchId: string }> }) {
  try {
    const { matchId } = await context.params;
    const id = z.uuid().parse(matchId);
    return Response.json(await issueLiveViewerToken(id, await getOpaqueSessionCachePartition()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mizarHttpError(error); }
}
