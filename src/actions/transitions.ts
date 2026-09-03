"use server";

import { revalidatePath } from "next/cache";
import { eq, count, and, not, inArray } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { seasons, seasonRegistrations, auditLogs, matches } from "@/db/schema";
import { normalizeRegistrationConfig, normalizeStagePlan } from "@/types/season";
import { revalidatePublicSeasonTags, updatePublicSeasonTags } from "@/lib/revalidation";

async function getApprovedCountInTx(tx: TxDb, seasonId: string): Promise<number> {
  const [row] = await tx
    .select({ count: count() })
    .from(seasonRegistrations)
    .where(
      and(
        eq(seasonRegistrations.seasonId, seasonId),
        eq(seasonRegistrations.status, "approved"),
      ),
    );
  return Number(row?.count ?? 0);
}

/**
 * 如果条件满足（通过数满 / 截止过期），自动推进 registration → 下一状态。
 * 必须在事务中调用——审批场景用外层的 tx，cron 场景自己包 transaction。
 */
export async function maybeAdvanceFromRegistration(
  tx: TxDb,
  seasonId: string,
  options: { invalidation?: "action" | "route" } = {},
): Promise<void> {
  const season = await tx.query.seasons.findFirst({
    where: eq(seasons.id, seasonId),
  });
  if (
    !season ||
    season.status !== "registration" ||
    season.registrationMode !== "solo" ||
    !season.registrationOpenedAt
  ) return;

  const registrationConfig = normalizeRegistrationConfig(season.registrationConfig);
  const approvedCount = await getApprovedCountInTx(tx, seasonId);
  const full = approvedCount >= registrationConfig.maxTotal;

  const deadlinePassed =
    season.registrationClosesAt != null &&
    new Date(season.registrationClosesAt).getTime() <= Date.now();

  if (!full && !deadlinePassed) return;

  const nextStatus = season.hasCaptainVoting ? "voting" : "playing";

  await tx
    .update(seasons)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(eq(seasons.id, seasonId));

  await tx.insert(auditLogs).values({
    seasonId,
    action: "season.auto_advance",
    actorId: "system",
    targetId: seasonId,
    targetType: "season",
    meta: {
      from: "registration",
      to: nextStatus,
      reason: full ? "capacity_reached" : "deadline_passed",
      approvedCount,
      maxTotal: registrationConfig.maxTotal,
      deadline: season.registrationClosesAt?.toISOString() ?? null,
    },
  });

  if (options.invalidation === "route") {
    revalidatePublicSeasonTags(season.slug, season.id);
  } else {
    updatePublicSeasonTags(season.slug, season.id);
  }
  revalidatePath(`/${season.slug}`);
  revalidatePath(`/admin/${season.slug}/registrations`);
}

/**
 * 如果赛季是 playing 状态且所有比赛都已结束（finished 或 cancelled），
 * 自动将赛季推进到 finished。
 * 必须在事务中调用。
 */
export async function maybeFinishSeason(
  tx: TxDb,
  seasonId: string,
): Promise<void> {
  const season = await tx.query.seasons.findFirst({
    where: eq(seasons.id, seasonId),
  });
  if (
    !season ||
    season.status !== "playing" ||
    normalizeStagePlan(season.stagePlan).some((stage) => stage.type === "swiss")
  ) return;

  // 检查是否所有比赛都已结束（finished 或 cancelled）
  const [pendingMatch] = await tx
    .select({ count: count() })
    .from(matches)
    .where(
      and(
        eq(matches.seasonId, seasonId),
        not(inArray(matches.status, ["finished", "cancelled"])),
      ),
    );

  if (Number(pendingMatch?.count ?? 0) > 0) return;

  await tx
    .update(seasons)
    .set({ status: "finished", updatedAt: new Date() })
    .where(eq(seasons.id, seasonId));

  await tx.insert(auditLogs).values({
    seasonId,
    action: "season.auto_finish",
    actorId: "system",
    targetId: seasonId,
    targetType: "season",
    meta: { from: "playing", to: "finished", reason: "all_matches_completed" },
  });

  updatePublicSeasonTags(season.slug, season.id);
  revalidatePath(`/${season.slug}`);
}
