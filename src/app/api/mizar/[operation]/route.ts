import { z } from "zod";
import { authenticateMizar, revokeMizarInstallation } from "@/lib/mizar/installation";
import { loadMizarMatchDocument, loadMizarScheduleWindow } from "@/lib/mizar/context";
import { claimMizarSource, releaseMizarSource, sourceClaimSchema } from "@/lib/mizar/source";
import { ingestMizarReliable } from "@/lib/mizar/reliable";
import { ingestMizarLive } from "@/lib/mizar/live";
import { mizarHttpError, mizarContextResponse, readBoundedMizarJson } from "@/lib/mizar/http";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { db } from "@/db/client";
import { eq } from "drizzle-orm";
import { seasons } from "@/db/schema";

type Context = { params: Promise<{ operation: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const installation = await authenticateMizar(request.headers.get("authorization"));
    const { operation } = await context.params;
    const query = new URL(request.url).searchParams;
    if (operation === "match") return mizarContextResponse(request, await loadMizarMatchDocument(z.uuid().parse(query.get("matchId")), installation.competitionId));
    if (operation === "schedule") return mizarContextResponse(request, await loadMizarScheduleWindow(installation.competitionId, new Date(query.get("from") ?? ""), new Date(query.get("to") ?? "")));
    return new Response(null, { status: 404 });
  } catch (error) { return mizarHttpError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const { operation } = await context.params;
    if (operation === "disconnect" || operation === "revoke") {
      const installation = await authenticateMizar(request.headers.get("authorization"), { allowRevoked: true });
      await revokeMizarInstallation(installation.id, installation.competitionId, installation.authorizedByUserId);
      return Response.json({ revoked: true });
    }
    const installation = await authenticateMizar(request.headers.get("authorization"));
    const input = await readBoundedMizarJson(request, operation === "live" ? 262_144 : 20_480);
    if (operation === "claim") return Response.json(await claimMizarSource(installation.id, installation.competitionId, sourceClaimSchema.parse(input)));
    if (operation === "release") {
      const { matchId } = z.strictObject({ matchId: z.uuid() }).parse(input);
      await releaseMizarSource(installation.id, installation.competitionId, matchId);
      return Response.json({ released: true });
    }
    const revision = z.coerce.number().int().positive().parse(request.headers.get("x-rivalhub-authority"));
    if (operation === "live") return Response.json(await ingestMizarLive(installation.id, installation.competitionId, input, revision));
    if (operation === "reliable") {
      const envelope = z.strictObject({ event: z.unknown(), lineupSteam64: z.array(z.string().regex(/^\d{17}$/)).max(10).default([]) }).parse(input);
      const outcome = await ingestMizarReliable(installation.id, installation.competitionId, envelope.event, revision, envelope.lineupSteam64);
      const [season] = await db.select({ slug: seasons.slug }).from(seasons).where(eq(seasons.id, installation.competitionId));
      const { matchId } = z.object({ matchId: z.uuid() }).parse(envelope.event);
      if (season) revalidateMatchPaths(season.slug, matchId);
      return Response.json(outcome);
    }
    return new Response(null, { status: 404 });
  } catch (error) { return mizarHttpError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { operation } = await context.params;
    if (operation === "disconnect" || operation === "revoke" || operation === "installation") {
      const installation = await authenticateMizar(request.headers.get("authorization"), { allowRevoked: true });
      await revokeMizarInstallation(installation.id, installation.competitionId, installation.authorizedByUserId);
      return Response.json({ revoked: true });
    }
    return new Response(null, { status: 404 });
  } catch (error) { return mizarHttpError(error); }
}
