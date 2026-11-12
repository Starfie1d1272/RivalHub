import { after } from "next/server";
import { getCacheHandler } from "next/dist/server/use-cache/handlers";
import { expirePublicTag, revalidateMatchPaths } from "@/lib/revalidation";
import { planMatchProjectionInvalidation } from "./plan";

export function revalidateMatchProjectionPaths(
  context: { slug: string; seasonId: string; matchId: string; matchStatus: string },
  receipt: { changed: boolean; affectedFacts?: readonly string[] },
  options: {
    mode?: "action" | "route";
    statistics?: boolean;
    seenTags?: Map<string, boolean>;
  } = {},
): void {
  if (!receipt.changed) return;
  const plan = planMatchProjectionInvalidation(
    context,
    receipt.affectedFacts,
    options.statistics === true,
  );
  revalidateMatchPaths(context.slug, context.matchId, {
    mode: options.mode,
    statisticsReason: receipt.affectedFacts?.includes("statistics") ? "scoreboard" : "veto",
    statistics: plan.statistics
      ? { seasonId: context.seasonId, matchId: context.matchId }
      : undefined,
    seenTags: options.seenTags,
  });
  expirePublicTag(plan.immediateTag, options.mode ?? "action", options.seenTags);
}

/** Observe the actual Next handler. A request can close before its queued revalidations run. */
export async function acknowledgeAfterExpiry(
  tags: readonly string[],
  acknowledge: () => Promise<void>,
) {
  const handler = getCacheHandler("remote");
  if (!handler) throw new Error("Public cache handler is unavailable.");
  const expirations = () => Promise.all(tags.map((tag) => handler.getExpiration([tag])));
  const before = await expirations();
  after(async () => {
    const applied = await expirations();
    // Hard expiry can replace a previous SWR deadline that was in the future.
    const now = Date.now() + 1;
    if (applied.every((value, index) => value > 0 && value <= now && value !== before[index]))
      await acknowledge();
  });
}
