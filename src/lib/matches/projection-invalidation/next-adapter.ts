import { after } from "next/server";
import { getCacheHandler } from "next/dist/server/use-cache/handlers";
import { captureException } from "@/lib/observability/server";
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

/** Next's public revalidation calls enqueue work. Keep its handler observation here. */
export async function observeHardExpiry(
  tags: readonly string[],
  settle: (confirmed: boolean) => Promise<void>,
) {
  const report = (error: unknown) =>
    captureException("match.projection_invalidation.expiry_observation_failed", error, {
      scope: "match",
      operation: "projection-invalidation.observe-expiry",
      retryable: true,
    });
  try {
    const handler = getCacheHandler("remote");
    if (!handler || !tags.length) throw new Error("Hard-expiry observation is unavailable.");
    const expirations = async () => Promise.all(tags.map((tag) => handler.getExpiration([tag])));
    const before = await expirations();
    after(async () => {
      const applied = await expirations().catch((error: unknown) => {
        report(error);
        return [];
      });
      // Next rounds its monotonic clock to milliseconds. Hard expiry can replace a future SWR deadline.
      const now = Date.now() + 1;
      await settle(
        applied.length === before.length &&
          applied.every((value, index) => value > 0 && value <= now && value !== before[index]),
      );
    });
  } catch (error) {
    report(error);
    await settle(false);
  }
}
