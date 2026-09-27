"use server";

import { z } from "zod";
import { ok } from "@/types/action";
import { AppError, ErrorCode } from "@/lib/errors";
import { actionError, getMatchOrThrow } from "@/lib/action-utils";
import { auditActorId, getCurrentUserAuthorization, requireAuth, requireSeasonAdmin } from "@/lib/auth/session";
import { revalidateMatchPaths } from "@/lib/revalidation";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import {
  claimVetoRepresentative,
  pauseVetoRoom,
  requestVetoStart,
  resolveVetoAppeal,
  resumeVetoRoom,
  rewindVetoRoom,
  reconcileVetoRoomTimeout,
  setManualPrivilegedEntry,
  setVetoRepresentative,
  submitVetoAppeal,
  submitVetoCommand,
} from "@/lib/matches/veto-room/service";
import { getVetoRoomView } from "@/lib/matches/veto-room/read-model";

const uuid = z.string().uuid();
const base = z.object({ matchId: uuid });
const revision = z.object({
  expectedRevision: z.number().int().nonnegative(),
  expectedTurnKey: z.string().max(100).nullable(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(ErrorCode.VALIDATION_FAILED, "请求内容无效，请刷新页面后重试。");
  return result.data;
}

async function finishMutation<T>(matchId: string, outcome: T) {
  const match = await getMatchOrThrow(matchId);
  const season = await db.query.seasons.findFirst({ where: eq(seasons.id, match.seasonId) });
  if (season) revalidateMatchPaths(season.slug, matchId);
  return ok({ outcome, room: await getVetoRoomView(matchId) });
}

async function assertVetoRoomReadable(matchId: string): Promise<void> {
  const match = await getMatchOrThrow(matchId);
  const [season] = await db.select({ id: seasons.id, slug: seasons.slug })
    .from(seasons)
    .where(eq(seasons.id, match.seasonId))
    .limit(1);
  const readableSeason = season ? await getPublicOrAuthorizedDraftSeason(season.slug) : null;
  if (!season || readableSeason?.id !== season.id) {
    throw new AppError(ErrorCode.MATCH_NOT_FOUND, "比赛不存在。");
  }
}

export async function readVetoRoom(matchIdInput: unknown) {
  try {
    const { matchId } = parse(base, { matchId: matchIdInput });
    await assertVetoRoomReadable(matchId);
    return ok(await getVetoRoomView(matchId));
  } catch (error) {
    return actionError("readVetoRoom", error);
  }
}

export async function reconcileVetoRoomTimeoutAction(input: unknown) {
  try {
    const { matchId } = parse(base, input);
    await assertVetoRoomReadable(matchId);
    return await finishMutation(matchId, await reconcileVetoRoomTimeout(matchId));
  } catch (error) {
    return actionError("reconcileVetoRoomTimeout", error);
  }
}

export async function setManualVetoPrivilege(input: unknown) {
  try {
    const { matchId, entryId } = parse(base.extend({ entryId: uuid }), input);
    const match = await getMatchOrThrow(matchId);
    const admin = await requireSeasonAdmin(match.seasonId);
    return await finishMutation(matchId, await setManualPrivilegedEntry({
      matchId,
      entryId,
      actorId: auditActorId(admin),
    }));
  } catch (error) {
    return actionError("setManualVetoPrivilege", error);
  }
}

export async function updateVetoRepresentative(input: unknown) {
  try {
    const { matchId, entryId, eventRosterMemberId } = parse(base.extend({ entryId: uuid, eventRosterMemberId: uuid }), input);
    const match = await getMatchOrThrow(matchId);
    const actor = await requireAuth();
    const authorization = await getCurrentUserAuthorization();
    const isAdmin = Boolean(authorization && (authorization.role === "super_admin" || authorization.seasonIds.includes(match.seasonId)));
    return await finishMutation(matchId, await setVetoRepresentative({
      matchId,
      entryId,
      eventRosterMemberId,
      actorId: auditActorId(actor),
      isAdmin,
    }));
  } catch (error) {
    return actionError("updateVetoRepresentative", error);
  }
}

export async function claimVetoRepresentativeAction(input: unknown) {
  try {
    const { matchId, entryId } = parse(base.extend({ entryId: uuid }), input);
    const actor = await requireAuth();
    return await finishMutation(matchId, await claimVetoRepresentative({ matchId, entryId, actorId: auditActorId(actor) }));
  } catch (error) {
    return actionError("claimVetoRepresentative", error);
  }
}

export async function requestVetoRoomStart(input: unknown) {
  try {
    const parsed = parse(base.extend({ entryId: uuid }).merge(revision), input);
    const actor = await requireAuth();
    return await finishMutation(parsed.matchId, await requestVetoStart({ ...parsed, actorId: auditActorId(actor) }));
  } catch (error) {
    return actionError("requestVetoRoomStart", error);
  }
}

const command = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("role_select"), entryId: uuid }),
  z.object({
    kind: z.literal("step"),
    actionType: z.enum(["ban", "pick", "side_pick"]),
    mapName: z.string().min(1).max(100).optional(),
    side: z.enum(["t", "ct"]).optional(),
  }),
]);

export async function performVetoRoomCommand(input: unknown) {
  try {
    const parsed = parse(base.extend({
      ...revision.shape,
      expectedTurnKey: z.string().min(1).max(100),
      clientRequestId: uuid,
      command,
    }), input);
    const actor = await requireAuth();
    return await finishMutation(parsed.matchId, await submitVetoCommand({ ...parsed, actorId: auditActorId(actor) }));
  } catch (error) {
    return actionError("performVetoRoomCommand", error);
  }
}

export async function pauseVetoRoomAction(input: unknown) {
  try {
    const { matchId, reason } = parse(base.extend({ reason: z.string().min(3).max(500) }), input);
    const match = await getMatchOrThrow(matchId);
    const admin = await requireSeasonAdmin(match.seasonId);
    await pauseVetoRoom({ matchId, actorId: auditActorId(admin), reason });
    return await finishMutation(matchId, "applied");
  } catch (error) {
    return actionError("pauseVetoRoom", error);
  }
}

export async function resumeVetoRoomAction(input: unknown) {
  try {
    const { matchId } = parse(base, input);
    const match = await getMatchOrThrow(matchId);
    const admin = await requireSeasonAdmin(match.seasonId);
    await resumeVetoRoom({ matchId, actorId: auditActorId(admin) });
    return await finishMutation(matchId, "applied");
  } catch (error) {
    return actionError("resumeVetoRoom", error);
  }
}

export async function submitVetoRoomAppeal(input: unknown) {
  try {
    const parsed = parse(base.extend({ incidentId: uuid, reason: z.string().min(3).max(500) }), input);
    const actor = await requireAuth();
    await submitVetoAppeal({ ...parsed, actorId: auditActorId(actor) });
    return await finishMutation(parsed.matchId, "applied");
  } catch (error) {
    return actionError("submitVetoRoomAppeal", error);
  }
}

export async function resolveVetoRoomAppeal(input: unknown) {
  try {
    const parsed = parse(base.extend({
      appealId: uuid,
      resolutionScope: z.enum(["platform_or_organizer", "participant_or_unverified"]),
      resolutionNote: z.string().min(3).max(500),
    }), input);
    const match = await getMatchOrThrow(parsed.matchId);
    const admin = await requireSeasonAdmin(match.seasonId);
    await resolveVetoAppeal({ ...parsed, actorId: auditActorId(admin) });
    return await finishMutation(parsed.matchId, "applied");
  } catch (error) {
    return actionError("resolveVetoRoomAppeal", error);
  }
}

export async function rewindVetoRoomAction(input: unknown) {
  try {
    const parsed = parse(base.extend({ targetTurnKey: z.string().min(1).max(100), reason: z.string().min(3).max(500) }), input);
    const match = await getMatchOrThrow(parsed.matchId);
    const admin = await requireSeasonAdmin(match.seasonId);
    await rewindVetoRoom({ ...parsed, actorId: auditActorId(admin) });
    return await finishMutation(parsed.matchId, "applied");
  } catch (error) {
    return actionError("rewindVetoRoom", error);
  }
}
