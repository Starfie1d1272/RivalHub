import { setDbTrafficSource } from "@/lib/observability/db-traffic";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { authenticateMizar, readMizarCredentialHash, revokeMizarInstallation } from "@/lib/mizar/installation";
import { loadBroadcastStats } from "@/lib/mizar/stats";
import { loadMizarMatchDocument, loadMizarScheduleWindow } from "@/lib/mizar/context";
import { claimMizarSource, releaseMizarSource, readMizarSourceStatus, sourceClaimSchema, sourceReleaseSchema, sourceStatusSchema } from "@/lib/mizar/source";
import { ingestMizarReliable } from "@/lib/mizar/reliable";
import { admitLiveIngress, tryAdmitLiveRequest } from "@/lib/mizar/live-admission";
import { ingestMizarLive } from "@/lib/mizar/live";
import { withMizarRequest, mizarContextResponse, readBoundedMizarJson } from "@/lib/mizar/http";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { db } from "@/db/client";
import { eq } from "drizzle-orm";
import { seasons } from "@/db/schema";
import { recordLiveIngestStage } from "@/lib/observability/server";

type Context = { params: Promise<{ operation: string }> };
export async function GET(request: Request, context: Context) {
  return withMizarRequest(request, "/api/mizar/[operation]", "get", async (diagnostics) => {
    const { operation } = await context.params;
    diagnostics.operation = operation === "match" || operation === "schedule" || operation === "source-status" ? operation : "unknown";
    setDbTrafficSource(operation === "match" ? "mizar.manifest" : operation === "schedule" ? "mizar.schedule" : "mizar");
    const installation = await authenticateMizar(request.headers.get("authorization"));
    const query = new URL(request.url).searchParams;
    diagnostics.phase = "validate";
    if (operation === "source-status") {
      const input = sourceStatusSchema.parse({ matchId: query.get("matchId"), producerInstanceId: query.get("producerInstanceId"), liveSessionId: query.get("liveSessionId"), authorityRevision: query.get("authorityRevision") ?? undefined });
      diagnostics.phase = "domain";
      return Response.json(await readMizarSourceStatus(installation.id, installation.competitionId, input), { headers: { "Cache-Control": "no-store" } });
    }
    if (operation === "match") {
      const matchId = z.uuid().parse(query.get("matchId"));
      diagnostics.phase = "domain";
      return mizarContextResponse(request, await loadMizarMatchDocument(matchId, installation.competitionId));
    }
    if (operation === "stats") {
      const matchId = z.uuid().parse(query.get("matchId"));
      diagnostics.phase = "domain";
      return mizarContextResponse(request, await loadBroadcastStats(matchId, installation.competitionId));
    }
    if (operation === "schedule") {
      diagnostics.phase = "domain";
      return mizarContextResponse(request, await loadMizarScheduleWindow(installation.competitionId, new Date(query.get("from") ?? ""), new Date(query.get("to") ?? ""), installation.authorizedByUserId));
    }
    return new Response(null, { status: 404 });
  });
}

export async function POST(request: Request, context: Context) {
  return withMizarRequest(request, "/api/mizar/[operation]", "post", async (diagnostics) => {
    const receivedAt = performance.now();
    let releaseIngress: (() => void) | null = null;
    let releaseLive: (() => void) | null = null;
    try {
      const { operation } = await context.params;
      diagnostics.operation = ["live", "disconnect", "claim", "release", "reliable"].includes(operation) ? operation : "unknown";
      setDbTrafficSource(operation === "live" ? "mizar.live" : operation === "reliable" ? "mizar.reliable" : operation === "claim" ? "mizar.claim" : operation === "release" ? "mizar.release" : operation === "disconnect" ? "mizar.disconnect" : "mizar");
      if (operation === "live") {
        recordLiveIngestStage("received");
        releaseIngress = await admitLiveIngress();
        if (!releaseIngress) {
          recordLiveIngestStage("capacity", performance.now() - receivedAt);
          return Response.json({ accepted: false, reason: "capacity" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "1" } });
        }
        const credentialHash = readMizarCredentialHash(request.headers.get("authorization"));
        diagnostics.phase = "read";
        const input = await readBoundedMizarJson(request, 262_144, 2000);
        diagnostics.phase = "validate";
        const { matchId } = z.object({ matchId: z.uuid() }).parse(input);
        // Untrusted scheduling key, not authority. Fairness covers auth latency too;
        // one installation's simultaneous matches get distinct turns.
        releaseLive = tryAdmitLiveRequest(`${credentialHash}:${matchId}`);
        releaseIngress();
        releaseIngress = null;
        if (!releaseLive) {
          recordLiveIngestStage("capacity", performance.now() - receivedAt);
          return Response.json({ accepted: false, reason: "capacity" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "1" } });
        }
        diagnostics.phase = "validate";
        const revision = z.coerce.number().int().positive().parse(request.headers.get("x-rivalhub-authority"));
        recordLiveIngestStage("admitted", performance.now() - receivedAt);
        diagnostics.phase = "domain";
        return Response.json(await ingestMizarLive(credentialHash, input, revision, receivedAt));
      }
      if (operation === "disconnect") {
        const installation = await authenticateMizar(request.headers.get("authorization"), { allowRevoked: true });
        diagnostics.phase = "domain";
        await revokeMizarInstallation(installation.id, installation.competitionId, installation.id);
        return Response.json({ revoked: true });
      }
      const installation = await authenticateMizar(request.headers.get("authorization"));
      diagnostics.phase = "read";
      const input = await readBoundedMizarJson(request, 20_480);
      diagnostics.phase = "validate";
      if (operation === "claim") {
        const claim = sourceClaimSchema.parse(input);
        diagnostics.phase = "domain";
        return Response.json(await claimMizarSource(installation.id, installation.competitionId, claim));
      }
      const revision = z.coerce.number().int().positive().parse(request.headers.get("x-rivalhub-authority"));
      if (operation === "release") {
        const release = sourceReleaseSchema.parse(input);
        diagnostics.phase = "domain";
        await releaseMizarSource(installation.id, installation.competitionId, release, revision);
        return Response.json({ released: true });
      }
      if (operation === "reliable") {
        const envelope = z.strictObject({ event: z.unknown(), lineupSteam64: z.array(z.string().regex(/^\d{17}$/)).max(10).default([]) }).parse(input);
        diagnostics.phase = "domain";
        const outcome = await ingestMizarReliable(installation.id, installation.competitionId, envelope.event, revision, envelope.lineupSteam64);
        diagnostics.phase = "revalidation";
        const [season] = await db.select({ slug: seasons.slug }).from(seasons).where(eq(seasons.id, installation.competitionId));
        const { matchId } = z.object({ matchId: z.uuid() }).parse(envelope.event);
        if (season) {
          if (outcome.outcome === "canonicalized") {
            revalidateMatchPaths(season.slug, matchId, { mode: "route", statisticsReason: outcome.duplicate ? "mizar.canonicalized_duplicate" : "mizar.canonicalized_new" });
          } else if (!outcome.duplicate) {
            // Source health/telemetry changes do not alter the statistical corpus.
            revalidatePath(`/admin/${season.slug}/matches/${matchId}`);
            revalidatePath(`/${season.slug}/matches/${matchId}`);
          }
        }
        return Response.json(outcome);
      }
      return new Response(null, { status: 404 });
    } finally { releaseIngress?.(); releaseLive?.(); }
  });
}
