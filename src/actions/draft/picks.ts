"use server";

import { writeAuditInTx } from "@/lib/audit/write";

import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { competitionEntries, draftState, seasons } from "@/db/schema";
import { ok, type ActionResult } from "@/types/action";
import { AppError, ErrorCode, ERROR_MESSAGES } from "@/lib/errors";
import { auditActorId, requireAuth, requireSeasonAdmin } from "@/lib/auth/session";
import { failValidation, actionError } from "@/lib/action-utils";
import { revalidateSeasonPaths } from "@/lib/revalidation";
import {
  pickPlayerSchema,
  skipDraftTurnSchema,
  type PickPlayerInput,
  type SkipDraftTurnInput,
} from "@/lib/validators/draft";
import { DRAFT_ROUND_TIMEOUT_SECONDS } from "@/types/draft";
import { getNextEntryId } from "@/lib/draft/rules";
import {
  assertCurrentDraftTurn,
  executeDraftPick,
  finalizeDraft,
  findDraftAutoPickCandidate,
} from "@/lib/draft/operations";

export async function pickPlayer(
  input: PickPlayerInput,
): Promise<ActionResult<{ pickId: string; idempotent: boolean; completed: boolean }>> {
  const parsed = pickPlayerSchema.safeParse(input);
  if (!parsed.success) {
    return failValidation("选择选手参数无效");
  }

  const { seasonId, expectedTurn, registrationId, clientRequestId } = parsed.data;

  try {
    const user = await requireAuth();
    const result = await db.transaction(async (tx) => {
      return executeDraftPick(tx, {
        seasonId,
        entryId: expectedTurn.entryId,
        registrationId,
        clientRequestId,
        expectedTurn,
        autoPicked: false,
        deadlinePolicy: "before-deadline",
        captainUserId: user.userId,
      });
    });

    revalidateSeasonPaths(result.slug, ["draft", "draftCaptain", "teams", "adminDraft"]);
    return ok({
      pickId: result.pickId,
      idempotent: result.idempotent,
      completed: result.completed,
    });
  } catch (e) {
    return actionError("pickPlayer", e);
  }
}

/** Operator recovery for a timed-out turn with no automatic pick candidate. */
export async function skipDraftTurn(
  input: SkipDraftTurnInput,
): Promise<ActionResult<{ skipped: boolean; completed: boolean }>> {
  const parsed = skipDraftTurnSchema.safeParse(input);
  if (!parsed.success) {
    return failValidation("跳过轮次参数无效");
  }
  const { seasonId, expectedTurn } = parsed.data;

  try {
    const admin = await requireSeasonAdmin(seasonId);
    const result = await db.transaction(async (tx) => {
      const season = await tx.query.seasons.findFirst({
        where: eq(seasons.id, seasonId),
      });
      if (!season) {
        throw new AppError(ErrorCode.SEASON_NOT_FOUND, ERROR_MESSAGES.SEASON_NOT_FOUND);
      }
      if (!season.hasDraft || season.status !== "drafting") {
        throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛事当前无法跳过选秀轮次。");
      }

      const [ds] = await tx
        .select()
        .from(draftState)
        .where(eq(draftState.seasonId, seasonId))
        .for("update");

      if (!ds?.isActive || !ds.currentEntryId) {
        throw new AppError(ErrorCode.DRAFT_NOT_ACTIVE, ERROR_MESSAGES.DRAFT_NOT_ACTIVE);
      }
      assertCurrentDraftTurn(ds, expectedTurn);
      const now = new Date();
      if (!ds.roundDeadline || ds.roundDeadline > now) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "当前轮次尚未超时。");
      }
      if (await findDraftAutoPickCandidate(tx, seasonId, ds.currentEntryId)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "本轮仍有符合条件的选手，请等待自动选人。");
      }

      const seasonTeams = await tx
        .select({
          id: competitionEntries.id,
          draftOrder: sql<number>`${competitionEntries.formationOrder}`.as("draft_order"),
        })
        .from(competitionEntries)
        .where(
          and(
            eq(competitionEntries.competitionId, seasonId),
            isNotNull(competitionEntries.formationOrder),
          ),
        )
        .orderBy(asc(competitionEntries.formationOrder));

      const skippedEntryId = ds.currentEntryId;
      const skippedRound = ds.currentRound;
      const next = getNextEntryId(seasonTeams, ds.currentEntryId, ds.currentRound);

      if (!next) {
        await finalizeDraft(tx, {
          seasonId,
          draftStateId: ds.id,
          now,
          actorId: auditActorId(admin),
        });

        await writeAuditInTx(tx, {
          seasonId,
          action: "draft.skip_turn",
          actorId: auditActorId(admin),
          targetId: ds.id,
          meta: {
            skippedEntryId,
            round: skippedRound,
            draftCompleted: true,
            actorEmail: admin.email,
          },
        });

        return { slug: season.slug, completed: true };
      }

      const deadline = new Date(now.getTime() + DRAFT_ROUND_TIMEOUT_SECONDS * 1000);
      await tx
        .update(draftState)
        .set({
          currentRound: next.nextRound,
          currentEntryId: next.entryId,
          roundDeadline: deadline,
          isActive: true,
          updatedAt: now,
        })
        .where(eq(draftState.id, ds.id));

      await writeAuditInTx(tx, {
        seasonId,
        action: "draft.skip_turn",
        actorId: auditActorId(admin),
        targetId: ds.id,
        meta: {
          skippedEntryId,
          round: skippedRound,
          nextEntryId: next.entryId,
          nextRound: next.nextRound,
          actorEmail: admin.email,
        },
      });

      return { slug: season.slug, completed: false };
    });

    revalidateSeasonPaths(result.slug, ["draft", "draftCaptain", "teams", "adminDraft"]);
    return ok({ skipped: true, completed: result.completed });
  } catch (e) {
    return actionError("skipDraftTurn", e);
  }
}
