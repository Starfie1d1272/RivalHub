import { revalidateTag, updateTag } from "next/cache";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { planMatchProjectionInvalidation } from "./plan";

export function revalidateMatchProjectionPaths(
  context: { slug: string; seasonId: string; matchId: string; matchStatus: string },
  receipt: { changed: boolean; affectedFacts?: readonly string[] },
  options: { mode?: "action" | "route"; statistics?: boolean } = {},
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
    statistics: plan.statistics,
  });
  if (options.mode === "route") revalidateTag(plan.immediateTag, { expire: 0 });
  else updateTag(plan.immediateTag);
}
