"use server";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, max, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { competitionEntries, competitionQualificationEntrants, majorTournamentEntrants, matches, competitionEntryActiveClaims, competitionEntryParticipants, competitionEntryRepresentativeChanges, competitionEntryRosterMembers, competitionEntryRosterRevisions, draftState, eventRosterMembers, eventRosters, seasonRegistrations, seasons, users } from "@/db/schema";
import { auditActorId, requireSeasonAdmin } from "@/lib/auth/session";
import { writeAuditInTx } from "@/lib/audit/write";
import { actionError, failValidation } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { revalidateSeasonPaths } from "@/lib/revalidation";
import { ok, type ActionResult } from "@/types/action";
import { getPublicDisplayName } from "@/lib/identity/display-name";
import { decodeSeasonRules } from "@/lib/seasons/rules";
import { requestCompetitionEntryRosterChangeInTx } from "@/lib/competition-entries/roster-change";
import { adoptEventNativeRosterInTx } from "@/lib/competition-entries/commands";
import { assertSinglePrestartEntryCoherenceInTx } from "@/lib/event-rosters/coherence";
import { adoptApprovedRosterInTx } from "@/lib/event-rosters/owner";
import { prepareApprovedEventRosterInTx } from "@/lib/event-rosters/prepare-approved";

const inputSchema = z.object({ seasonId: z.guid(), entryId: z.guid().nullable(), captainId: z.guid(), memberIds: z.array(z.guid()).max(20), starterIds: z.array(z.guid()).max(20) });

/** Save an incomplete formation; submission and approval belong to Entry. */
export async function saveManualFormation(input: z.infer<typeof inputSchema>): Promise<ActionResult<{ entryId: string }>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return failValidation("编队参数无效");
  const { seasonId, entryId, captainId, memberIds, starterIds } = parsed.data;
  const admin = await requireSeasonAdmin(seasonId);
  try {
    const result = await db.transaction(async tx => {
      const [season] = await tx.select().from(seasons).where(eq(seasons.id, seasonId)).for("update");
      if (!season || season.registrationMode !== "solo" || !["registration", "drafting"].includes(season.status)) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "当前赛事不能手动编队。");
      if (season.hasDraft && !entryId && (season.hasCaptainVoting || decodeSeasonRules(season).source !== "policy_v2" || memberIds.some(id => id !== captainId))) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "当前选秀只允许管理员创建队长队伍。");
      if (season.hasDraft && !entryId && await tx.query.draftState.findFirst({ where: eq(draftState.seasonId, seasonId) })) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "选秀开始后不能增加队伍。");
      if (season.hasDraft && entryId) {
        const state = await tx.query.draftState.findFirst({ where: eq(draftState.seasonId, seasonId) });
        if (!state || state.isActive || state.currentEntryId) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "选秀结束后才能补正名单。");
      }
      const members = [captainId, ...memberIds.filter(id => id !== captainId)];
      if (new Set(memberIds).size !== memberIds.length || new Set(starterIds).size !== starterIds.length || starterIds.some(id => !members.includes(id))) throw new AppError(ErrorCode.VALIDATION_FAILED, "成员或首发重复，或首发不在队伍中。");
      if (members.length > season.maxTeamSize || starterIds.length > season.starterCount) throw new AppError(ErrorCode.VALIDATION_FAILED, "队伍人数或首发人数超过上限。");
      const registrations = await tx.select().from(seasonRegistrations).where(and(eq(seasonRegistrations.seasonId, seasonId), inArray(seasonRegistrations.id, members)));
      if (registrations.length !== members.length || registrations.some(row => row.status !== "approved")) throw new AppError(ErrorCode.VALIDATION_FAILED, "只能选择本赛事已通过审核的报名选手。");
      const byId = new Map(registrations.map(row => [row.id, row]));
      const captain = byId.get(captainId)!;
      const userIds = registrations.map(row => row.userId);
      if (new Set(userIds).size !== userIds.length) throw new AppError(ErrorCode.PLAYER_ALREADY_PICKED, "选手不能重复占位。");
      const activeUsers = await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, userIds), eq(users.status, "active")));
      if (activeUsers.length !== userIds.length) throw new AppError(ErrorCode.VALIDATION_FAILED, "名单中有不可用的选手账号。");
      const claims = await tx.select({ entryId: competitionEntryActiveClaims.entryId }).from(competitionEntryActiveClaims).where(and(eq(competitionEntryActiveClaims.competitionId, seasonId), inArray(competitionEntryActiveClaims.userId, userIds)));
      if (claims.some(claim => claim.entryId !== entryId)) throw new AppError(ErrorCode.PLAYER_ALREADY_PICKED, "选手已确认其他队伍的报名。");
      const existingMembers = await tx.select({ entryId: competitionEntries.id, userId: competitionEntryRosterMembers.userId }).from(competitionEntryRosterMembers)
        .innerJoin(competitionEntries, eq(competitionEntries.currentRosterRevisionId, competitionEntryRosterMembers.revisionId))
        .where(and(eq(competitionEntries.competitionId, seasonId), inArray(competitionEntries.registrationStatus, ["draft", "submitted", "changes_requested", "waitlisted", "approved"]), inArray(competitionEntryRosterMembers.userId, userIds)));
      if (existingMembers.some(row => row.entryId !== entryId)) throw new AppError(ErrorCode.PLAYER_ALREADY_PICKED, "选手已在其他队伍中。");
      let entry = entryId ? (await tx.select().from(competitionEntries).where(and(eq(competitionEntries.id, entryId), eq(competitionEntries.competitionId, seasonId))).for("update"))[0] : undefined;
      if (entryId && (!entry || entry.source !== "event_native" || !(["draft", "changes_requested"].includes(entry.registrationStatus)) || entry.sourceRegistrationId !== captainId)) throw new AppError(ErrorCode.VALIDATION_FAILED, "该队伍不可编辑或队长已变更。");
      if (!entry) {
        const revisionId = randomUUID();
        const [captainUser] = await tx.select({ displayName: users.displayName, perfectName: users.perfectName }).from(users).where(eq(users.id, captain.userId));
        const [order] = season.hasDraft ? await tx.select({ value: max(competitionEntries.formationOrder) }).from(competitionEntries).where(and(eq(competitionEntries.competitionId, seasonId), isNotNull(competitionEntries.formationOrder))) : [];
        [entry] = await tx.insert(competitionEntries).values({ competitionId: seasonId, source: "event_native", name: `${getPublicDisplayName(captainUser ?? {})} 队`, representativeUserId: captain.userId, sourceRegistrationId: captainId, currentRosterRevisionId: revisionId, registrationStatus: "draft", formationOrder: season.hasDraft ? (order?.value ?? 0) + 1 : null }).returning();
        await tx.insert(competitionEntryRosterRevisions).values({ id: revisionId, entryId: entry.id, revisionNumber: 1, status: "draft", createdBy: auditActorId(admin) });
        await tx.insert(competitionEntryRepresentativeChanges).values({ entryId: entry.id, fromUserId: null, toUserId: captain.userId, changedByActorId: auditActorId(admin) });
      }
      const [revision] = await tx.select().from(competitionEntryRosterRevisions).where(eq(competitionEntryRosterRevisions.id, entry.currentRosterRevisionId)).for("update");
      if (!revision || revision.status !== "draft") throw new AppError(ErrorCode.VALIDATION_FAILED, "只有草稿名单可以编辑。");
      const participants = await tx.select().from(competitionEntryParticipants).where(eq(competitionEntryParticipants.entryId, entry.id));
      if (participants.some(participant => participant.status === "confirmed" && !userIds.includes(participant.userId))) throw new AppError(ErrorCode.VALIDATION_FAILED, "已确认成员须先通过赛事退出流程退出。");
      if (participants.some(participant => userIds.includes(participant.userId) && ["declined", "withdrawn"].includes(participant.status))) throw new AppError(ErrorCode.VALIDATION_FAILED, "已退出或拒绝的成员须先重新接受邀请。");
      await tx.delete(competitionEntryRosterMembers).where(eq(competitionEntryRosterMembers.revisionId, revision.id));
      for (const registrationId of members) {
        const userId = byId.get(registrationId)!.userId;
        const [participant] = await tx.insert(competitionEntryParticipants).values({ entryId: entry.id, userId, status: "invited", invitedByUserId: captain.userId }).onConflictDoUpdate({ target: [competitionEntryParticipants.entryId, competitionEntryParticipants.userId], set: { updatedAt: new Date() } }).returning({ id: competitionEntryParticipants.id });
        await tx.insert(competitionEntryRosterMembers).values({ revisionId: revision.id, participantId: participant.id, userId, isPrimaryStarter: starterIds.includes(registrationId) });
        if (season.hasDraft && !entryId) {
          const [roster] = await tx.insert(eventRosters).values({ entryId: entry.id, status: "preparing" }).returning({ id: eventRosters.id });
          await tx.insert(eventRosterMembers).values({ eventRosterId: roster.id, participantId: participant.id, userId, isPrimaryStarter: starterIds.includes(registrationId) });
        }
      }
      await writeAuditInTx(tx, { seasonId, action: "competition_entry.roster.save", actorId: auditActorId(admin), targetId: entry.id, meta: { source: "manual_formation", memberRegistrationIds: members, starterRegistrationIds: starterIds } });
      return { entryId: entry.id, slug: season.slug };
    });
    revalidateSeasonPaths(result.slug, ["adminDraft", "teams"]);
    return ok({ entryId: result.entryId });
  } catch (error) { return actionError("saveManualFormation", error); }
}

/** Approve the current completed roster and adopt it in the same transaction. */
export async function approveFormation(input: { seasonId: string; entryId: string; expectedRevisionId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: z.guid(), entryId: z.guid(), expectedRevisionId: z.guid() }).safeParse(input);
  if (!parsed.success) return failValidation("名单标识无效");
  const admin = await requireSeasonAdmin(parsed.data.seasonId);
  try {
    const slug = await db.transaction(async tx => {
      const [season] = await tx.select().from(seasons).where(eq(seasons.id, parsed.data.seasonId)).for("update");
      if (!season || !["registration", "voting", "drafting"].includes(season.status)) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "当前阶段不能审核编队名单。");
      const [entry] = await tx.select().from(competitionEntries).where(and(eq(competitionEntries.id, parsed.data.entryId), eq(competitionEntries.competitionId, season.id))).for("update");
      if (!entry || entry.source !== "event_native") throw new AppError(ErrorCode.NOT_FOUND, "赛事编队不存在。");
      if (season.hasDraft) {
        const state = await tx.query.draftState.findFirst({ where: eq(draftState.seasonId, season.id) });
        if (!state || state.isActive || state.currentEntryId) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "选秀结束后才能审核名单。");
      }
      const actorId = auditActorId(admin);
      const adopted = await adoptEventNativeRosterInTx(tx, { entryId: entry.id, expectedRevisionId: parsed.data.expectedRevisionId, actorId });
      await tx.insert(eventRosters).values({ entryId: entry.id, status: "preparing" }).onConflictDoNothing({ target: eventRosters.entryId });
      if (decodeSeasonRules(season).source === "policy_v2") {
        const assessment = adopted.assessment;
        if (!assessment) throw new AppError(ErrorCode.INTERNAL_ERROR, "新版名单缺少资格评估结果。");
        const coherent = await assertSinglePrestartEntryCoherenceInTx(tx, season.id, { competitionEntryId: entry.id }, { requireEventRosterSync: false });
        await adoptApprovedRosterInTx(tx, { coherent, actorId, assessment });
        await writeAuditInTx(tx, { seasonId: season.id, action: "competition_entry.sync_event_roster", actorId, targetId: entry.id, meta: { source: "formation", rosterRevisionId: parsed.data.expectedRevisionId } });
      } else {
        await prepareApprovedEventRosterInTx(tx, { seasonId: season.id, entryId: entry.id, actorId });
      }
      return season.slug;
    });
    revalidateSeasonPaths(slug, ["adminDraft", "teams"]);
    return ok(undefined);
  } catch (error) { return actionError("approveFormation", error); }
}

/** Cancel an unapproved formation only while no competition fact depends on it. */
export async function withdrawFormation(input: { seasonId: string; entryId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: z.guid(), entryId: z.guid() }).safeParse(input);
  if (!parsed.success) return failValidation("编队标识无效。");
  const admin = await requireSeasonAdmin(parsed.data.seasonId);
  try {
    const slug = await db.transaction(async tx => {
      const [season] = await tx.select().from(seasons).where(eq(seasons.id, parsed.data.seasonId)).for("update");
      if (!season || season.hasDraft || season.registrationMode !== "solo" || decodeSeasonRules(season).source !== "policy_v2" || !["registration", "drafting"].includes(season.status)) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "当前阶段不能撤销编队。");
      const [entry] = await tx.select().from(competitionEntries).where(and(eq(competitionEntries.id, parsed.data.entryId), eq(competitionEntries.competitionId, season.id))).for("update");
      if (!entry || entry.source !== "event_native" || entry.approvedRosterRevisionId || entry.registrationStatus !== "draft") throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "只能撤销尚未批准的编队草稿。");
      const [roster] = await tx.select().from(eventRosters).where(eq(eventRosters.entryId, entry.id)).for("update");
      const [match] = await tx.select({ id: matches.id }).from(matches).where(or(eq(matches.entryAId, entry.id), eq(matches.entryBId, entry.id))).limit(1);
      const [entrant] = await tx.select({ id: majorTournamentEntrants.id }).from(majorTournamentEntrants).where(eq(majorTournamentEntrants.competitionEntryId, entry.id)).limit(1);
      const [qualification] = await tx.select({ id: competitionQualificationEntrants.id }).from(competitionQualificationEntrants).where(eq(competitionQualificationEntrants.competitionEntryId, entry.id)).limit(1);
      if (match || entrant || qualification || (roster && roster.status !== "preparing")) throw new AppError(ErrorCode.REGISTRATION_INVALID_TRANSITION, "编队已有赛事依赖事实，不能撤销。");
      const now = new Date();
      await tx.delete(competitionEntryActiveClaims).where(eq(competitionEntryActiveClaims.entryId, entry.id));
      await tx.update(competitionEntryParticipants).set({ status: "withdrawn", withdrawnAt: now, updatedAt: now }).where(eq(competitionEntryParticipants.entryId, entry.id));
      await tx.update(competitionEntries).set({ registrationStatus: "withdrawn", updatedAt: now }).where(eq(competitionEntries.id, entry.id));
      await writeAuditInTx(tx, { seasonId: season.id, action: "competition_entry.withdrawn", actorId: auditActorId(admin), targetId: entry.id, meta: { source: "formation_withdrawal" } });
      return season.slug;
    });
    revalidateSeasonPaths(slug, ["adminDraft", "teams"]);
    return ok(undefined);
  } catch (error) { return actionError("withdrawFormation", error); }
}

/** Reopen an adopted native roster using the canonical revision transition. */
export async function requestFormationChange(input: { seasonId: string; entryId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: z.guid(), entryId: z.guid() }).safeParse(input);
  if (!parsed.success) return failValidation("编队标识无效。");
  const admin = await requireSeasonAdmin(parsed.data.seasonId);
  try {
    const slug = await db.transaction(async tx => {
      const [season] = await tx.select().from(seasons).where(eq(seasons.id, parsed.data.seasonId)).for("update");
      const [entry] = await tx.select().from(competitionEntries).where(and(eq(competitionEntries.id, parsed.data.entryId), eq(competitionEntries.competitionId, parsed.data.seasonId))).for("update");
      if (!season || !entry || entry.source !== "event_native" || decodeSeasonRules(season).source !== "policy_v2") throw new AppError(ErrorCode.NOT_FOUND, "赛事编队不存在。");
      return (await requestCompetitionEntryRosterChangeInTx(tx, { entryId: entry.id, representativeUserId: entry.representativeUserId, actorId: auditActorId(admin), source: "admin_formation" })).seasonSlug;
    });
    revalidateSeasonPaths(slug, ["adminDraft", "teams"]);
    return ok(undefined);
  } catch (error) { return actionError("requestFormationChange", error); }
}
