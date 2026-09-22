import "server-only";

import { writeAuditInTx } from "@/lib/audit/write";

import { and, count, eq, inArray, not } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { matches, seasonRegistrations, seasons } from "@/db/schema";
import { normalizeRegistrationConfig, normalizeStagePlan } from "@/lib/seasons/compatibility";

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
 * 必须在事务中调用；缓存刷新由事务外的 entrypoint 负责。
 */
export async function maybeAdvanceFromRegistration(
  tx: TxDb,
  seasonId: string,
): Promise<string | null> {
  const season = await tx.query.seasons.findFirst({
    where: eq(seasons.id, seasonId),
  });
  if (
    !season ||
    season.status !== "registration" ||
    season.registrationMode !== "solo" ||
    !season.registrationOpenedAt
  ) return null;

  const registrationConfig = normalizeRegistrationConfig(season.registrationConfig);
  const approvedCount = await getApprovedCountInTx(tx, seasonId);
  const full = approvedCount >= registrationConfig.maxTotal;

  const deadlinePassed =
    season.registrationClosesAt != null &&
    new Date(season.registrationClosesAt).getTime() <= Date.now();

  if (!full && !deadlinePassed) return null;

  const nextStatus = season.hasCaptainVoting ? "voting" : "playing";

  await tx
    .update(seasons)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(eq(seasons.id, seasonId));

  await writeAuditInTx(tx, {
    seasonId,
    action: "season.auto_advance",
    actorId: "system",
    targetId: seasonId,meta: {
      from: "registration",
      to: nextStatus,
      reason: full ? "capacity_reached" : "deadline_passed",
      approvedCount,
      maxTotal: registrationConfig.maxTotal,
      deadline: season.registrationClosesAt?.toISOString() ?? null,
    },
  });

  return season.slug;
}

/**
 * 如果赛季是 playing 状态且所有比赛都已结束（finished 或 cancelled），
 * 自动将赛季推进到 finished。必须在事务中调用；缓存刷新由 entrypoint 负责。
 */
export async function maybeFinishSeason(
  tx: TxDb,
  seasonId: string,
): Promise<string | null> {
  const season = await tx.query.seasons.findFirst({
    where: eq(seasons.id, seasonId),
  });
  if (
    !season ||
    season.status !== "playing" ||
    normalizeStagePlan(season.stagePlan).some((stage) => stage.type === "swiss")
  ) return null;

  const [pendingMatch] = await tx
    .select({ count: count() })
    .from(matches)
    .where(
      and(
        eq(matches.seasonId, seasonId),
        not(inArray(matches.status, ["finished", "cancelled"])),
      ),
    );

  if (Number(pendingMatch?.count ?? 0) > 0) return null;

  await tx
    .update(seasons)
    .set({ status: "finished", updatedAt: new Date() })
    .where(eq(seasons.id, seasonId));

  await writeAuditInTx(tx, {
    seasonId,
    action: "season.auto_finish",
    actorId: "system",
    targetId: seasonId,meta: { from: "playing", to: "finished", reason: "all_matches_completed" },
  });

  return season.slug;
}
