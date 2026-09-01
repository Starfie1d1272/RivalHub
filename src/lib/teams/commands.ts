import { and, count, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { TxDb } from "@/db/client";
import {
  auditLogs,
  competitionEntries,
  seasons,
  teamCaptainChanges,
  teamInvitations,
  teamMemberships,
  teamNameChanges,
  teamSlugAliases,
  teams,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { expirePendingInvitationsInTx } from "@/lib/teams/invitations";
import { closePlayerLftInTx, closeTeamRecruitmentForDisbandInTx } from "@/lib/recruitment/commands";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_RATE_LIMIT_PER_HOUR = 20;

function slugBase(name: string): string {
  return name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36);
}

function slugFor(name: string, id: string): string {
  return `${slugBase(name) || "team"}-${id.slice(0, 8)}`;
}

export function hashTeamInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function lockTeam(tx: TxDb, teamId: string) {
  const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
  if (!team) throw new AppError(ErrorCode.NOT_FOUND, "队伍不存在。");
  return team;
}

async function requireLockedCaptain(tx: TxDb, teamId: string, userId: string) {
  const team = await lockTeam(tx, teamId);
  if (team.status !== "active") throw new AppError(ErrorCode.VALIDATION_FAILED, "队伍已解散。");
  if (team.captainUserId !== userId) throw new AppError(ErrorCode.FORBIDDEN, "只有当前队长可以执行此操作。");
  return team;
}

async function auditTeam(tx: TxDb, action: string, actorId: string, teamId: string, meta?: Record<string, unknown>) {
  await tx.insert(auditLogs).values({ seasonId: null, action, actorId, targetId: teamId, targetType: "team", meta: meta ?? null });
}

async function nextCaptainChangeAt(tx: TxDb, teamId: string): Promise<Date> {
  const [latest] = await tx.select({ changedAt: teamCaptainChanges.changedAt }).from(teamCaptainChanges)
    .where(eq(teamCaptainChanges.teamId, teamId)).orderBy(desc(teamCaptainChanges.changedAt), desc(teamCaptainChanges.id)).limit(1);
  const now = Date.now();
  return new Date(Math.max(now, latest ? latest.changedAt.getTime() + 1 : now));
}

async function nextNameChangeAt(tx: TxDb, teamId: string): Promise<Date> {
  const [latest] = await tx.select({ changedAt: teamNameChanges.changedAt }).from(teamNameChanges)
    .where(eq(teamNameChanges.teamId, teamId)).orderBy(desc(teamNameChanges.changedAt), desc(teamNameChanges.id)).limit(1);
  const now = Date.now();
  return new Date(Math.max(now, latest ? latest.changedAt.getTime() + 1 : now));
}

export async function createTeamInTx(
  tx: TxDb,
  input: { name: string; description?: string | null; userId: string; actorId: string },
): Promise<{ teamId: string; slug: string }> {
  await tx.execute(sql`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`);
  const currentCaptaincy = await tx.query.teams.findFirst({ where: and(eq(teams.captainUserId, input.userId), eq(teams.status, "active")) });
  if (currentCaptaincy) throw new AppError(ErrorCode.VALIDATION_FAILED, "你已担任一支队伍的队长；请先完成队长交接。");
  const currentMembership = await tx.query.teamMemberships.findFirst({ where: and(eq(teamMemberships.userId, input.userId), isNull(teamMemberships.endedAt)) });
  if (currentMembership) throw new AppError(ErrorCode.VALIDATION_FAILED, "你当前已经加入一支队伍；请先退出原队伍。");

  const teamId = randomUUID();
  const slug = slugFor(input.name, teamId);
  await tx.insert(teams).values({ id: teamId, slug, name: input.name, description: input.description || null, creatorUserId: input.userId, captainUserId: input.userId });
  await tx.insert(teamMemberships).values({ teamId, userId: input.userId, status: "active", invitedByUserId: input.userId });
  await closePlayerLftInTx(tx, { userId: input.userId });
  await tx.insert(teamCaptainChanges).values({ teamId, fromUserId: null, toUserId: input.userId, changedByActorId: input.actorId });
  await tx.insert(teamNameChanges).values({ teamId, oldName: null, newName: input.name, changedByActorId: input.actorId });
  await auditTeam(tx, "team.create", input.actorId, teamId, { name: input.name, creatorUserId: input.userId });
  return { teamId, slug };
}

export async function updateTeamProfileInTx(
  tx: TxDb,
  input: { teamId: string; userId: string; actorId: string; name: string; description?: string | null },
): Promise<{ oldSlug: string; slug: string }> {
  const team = await requireLockedCaptain(tx, input.teamId, input.userId);
  const nameChanged = team.name !== input.name;
  const nextSlug = nameChanged ? slugFor(input.name, team.id) : team.slug;
  if (nameChanged) {
    await tx.insert(teamNameChanges).values({ teamId: team.id, oldName: team.name, newName: input.name, changedAt: await nextNameChangeAt(tx, team.id), changedByActorId: input.actorId });
    await tx.insert(teamSlugAliases).values({ slug: team.slug, teamId: team.id }).onConflictDoNothing();
  }
  await tx.update(teams).set({ name: input.name, slug: nextSlug, description: input.description || null, updatedAt: new Date() }).where(eq(teams.id, team.id));
  await auditTeam(tx, "team.update_profile", input.actorId, team.id, { fromName: team.name, toName: input.name });
  return { oldSlug: team.slug, slug: nextSlug };
}

export async function updateTeamLogoInTx(
  tx: TxDb,
  input: { teamId: string; userId: string; actorId: string; logoUrl: string },
): Promise<{ slug: string }> {
  const team = await requireLockedCaptain(tx, input.teamId, input.userId);
  await tx.update(teams).set({ logoUrl: input.logoUrl, updatedAt: new Date() }).where(eq(teams.id, team.id));
  await auditTeam(tx, "team.logo.update", input.actorId, team.id, { from: team.logoUrl, to: input.logoUrl });
  return { slug: team.slug };
}

async function assertInviteRate(tx: TxDb, teamId: string): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [{ value }] = await tx.select({ value: count() }).from(teamInvitations).where(and(eq(teamInvitations.teamId, teamId), gte(teamInvitations.createdAt, since)));
  if (Number(value) >= INVITE_RATE_LIMIT_PER_HOUR) throw new AppError(ErrorCode.VALIDATION_FAILED, "邀请过于频繁，请稍后再试。");
}

export async function inviteTeamMemberInTx(
  tx: TxDb,
  input: { teamId: string; userId: string; invitedUserId: string; actorId: string },
): Promise<void> {
  const team = await requireLockedCaptain(tx, input.teamId, input.userId);
  await assertInviteRate(tx, team.id);
  const current = await tx.query.teamMemberships.findFirst({ where: and(eq(teamMemberships.teamId, team.id), eq(teamMemberships.userId, input.invitedUserId), isNull(teamMemberships.endedAt)) });
  if (current) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "该用户当前已属于这支队伍。");
  const expiredCount = await expirePendingInvitationsInTx(tx, { teamId: team.id, invitedUserId: input.invitedUserId });
  await tx.insert(teamInvitations).values({ teamId: team.id, kind: "direct", invitedUserId: input.invitedUserId, invitedByUserId: input.userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
  await auditTeam(tx, "team.invite", input.actorId, team.id, { invitedUserId: input.invitedUserId, kind: "direct", expiredSuperseded: expiredCount });
}

export async function createTeamShareInvitationInTx(
  tx: TxDb,
  input: { teamId: string; userId: string; actorId: string },
): Promise<{ token: string; expiresAt: string }> {
  const team = await requireLockedCaptain(tx, input.teamId, input.userId);
  await assertInviteRate(tx, team.id);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await tx.insert(teamInvitations).values({ teamId: team.id, kind: "share_link", tokenHash: hashTeamInvitationToken(token), invitedByUserId: input.userId, expiresAt });
  await auditTeam(tx, "team.invite", input.actorId, team.id, { kind: "share_link", expiresAt: expiresAt.toISOString() });
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function declineTeamInvitationInTx(tx: TxDb, input: { invitationId: string; userId: string; actorId: string }): Promise<void> {
  const [invitation] = await tx.select().from(teamInvitations).where(eq(teamInvitations.id, input.invitationId)).for("update");
  if (!invitation || invitation.kind !== "direct" || invitation.invitedUserId !== input.userId || invitation.status !== "pending") throw new AppError(ErrorCode.NOT_FOUND, "邀请不存在或已失效。");
  const now = new Date();
  await tx.update(teamInvitations).set({ status: "declined", respondedAt: now, respondedByUserId: input.userId, updatedAt: now }).where(eq(teamInvitations.id, invitation.id));
  await auditTeam(tx, "team.invite.decline", input.actorId, invitation.teamId, { invitationId: invitation.id });
}

export async function revokeTeamInvitationInTx(tx: TxDb, input: { teamId: string; invitationId: string; userId: string; actorId: string }): Promise<void> {
  await requireLockedCaptain(tx, input.teamId, input.userId);
  const [invitation] = await tx.select().from(teamInvitations).where(and(eq(teamInvitations.id, input.invitationId), eq(teamInvitations.teamId, input.teamId))).for("update");
  if (!invitation || invitation.status !== "pending") throw new AppError(ErrorCode.NOT_FOUND, "待处理邀请不存在。");
  await tx.update(teamInvitations).set({ status: "revoked", respondedAt: null, respondedByUserId: null, updatedAt: new Date() }).where(eq(teamInvitations.id, invitation.id));
  await auditTeam(tx, "team.invite.revoke", input.actorId, input.teamId, { invitationId: invitation.id });
}

export async function setTeamMembershipStatusInTx(tx: TxDb, input: { teamId: string; userId: string; targetUserId: string; status: "active" | "benched"; actorId: string }): Promise<void> {
  const team = await requireLockedCaptain(tx, input.teamId, input.userId);
  if (input.targetUserId === team.captainUserId && input.status !== "active") throw new AppError(ErrorCode.VALIDATION_FAILED, "队长必须先完成交接，才能变为非当前成员。");
  await tx.execute(sql`SELECT id FROM users WHERE id = ${input.targetUserId} FOR UPDATE`);
  const [membership] = await tx.select().from(teamMemberships).where(and(eq(teamMemberships.teamId, team.id), eq(teamMemberships.userId, input.targetUserId), isNull(teamMemberships.endedAt))).for("update");
  if (!membership) throw new AppError(ErrorCode.NOT_FOUND, "当前成员不存在。");
  await tx.update(teamMemberships).set({ status: input.status, updatedAt: new Date() }).where(eq(teamMemberships.id, membership.id));
  await auditTeam(tx, "team.membership.status_change", input.actorId, team.id, { userId: input.targetUserId, from: membership.status, to: input.status });
}

async function endMembershipInTx(tx: TxDb, input: { teamId: string; targetUserId: string; actorId: string; reason: "left" | "kicked" }): Promise<void> {
  const [membership] = await tx.select().from(teamMemberships).where(and(eq(teamMemberships.teamId, input.teamId), eq(teamMemberships.userId, input.targetUserId), isNull(teamMemberships.endedAt))).for("update");
  if (!membership) throw new AppError(ErrorCode.NOT_FOUND, "当前成员不存在。");
  await tx.update(teamMemberships).set({ status: "left", endedAt: new Date(), endedReason: input.reason, updatedAt: new Date() }).where(eq(teamMemberships.id, membership.id));
  await auditTeam(tx, input.reason === "left" ? "team.membership.leave" : "team.membership.kick", input.actorId, input.teamId, { userId: input.targetUserId, previousStatus: membership.status });
}

export async function leaveTeamInTx(tx: TxDb, input: { teamId: string; userId: string; actorId: string }): Promise<void> {
  const team = await lockTeam(tx, input.teamId);
  if (team.captainUserId === input.userId) throw new AppError(ErrorCode.VALIDATION_FAILED, "队长必须先完成交接才能退出。");
  await endMembershipInTx(tx, { teamId: team.id, targetUserId: input.userId, actorId: input.actorId, reason: "left" });
}

export async function kickTeamMemberInTx(tx: TxDb, input: { teamId: string; userId: string; targetUserId: string; actorId: string }): Promise<void> {
  const team = await requireLockedCaptain(tx, input.teamId, input.userId);
  if (team.captainUserId === input.targetUserId) throw new AppError(ErrorCode.VALIDATION_FAILED, "队长不能踢出自己；请先完成交接。");
  await endMembershipInTx(tx, { teamId: team.id, targetUserId: input.targetUserId, actorId: input.actorId, reason: "kicked" });
}

export async function transferTeamCaptainInTx(tx: TxDb, input: { teamId: string; actorUserId: string; toUserId: string; actorId: string; emergencyOverride: boolean }): Promise<void> {
  const team = await lockTeam(tx, input.teamId);
  if (team.captainUserId !== input.actorUserId && !input.emergencyOverride) throw new AppError(ErrorCode.FORBIDDEN, "只有当前队长可以执行此操作。");
  await tx.execute(sql`SELECT id FROM users WHERE id IN (${team.captainUserId}, ${input.toUserId}) ORDER BY id FOR UPDATE`);
  const memberships = await tx.select().from(teamMemberships).where(and(eq(teamMemberships.teamId, team.id), inArray(teamMemberships.userId, [team.captainUserId, input.toUserId]), isNull(teamMemberships.endedAt))).for("update");
  const from = memberships.find((row) => row.userId === team.captainUserId);
  const to = memberships.find((row) => row.userId === input.toUserId);
  if (!from || !to || to.status !== "active") throw new AppError(ErrorCode.VALIDATION_FAILED, "新队长必须是该队当前 active 成员。");
  const otherCaptaincy = await tx.query.teams.findFirst({ where: and(eq(teams.captainUserId, input.toUserId), eq(teams.status, "active"), ne(teams.id, team.id)) });
  if (otherCaptaincy) throw new AppError(ErrorCode.VALIDATION_FAILED, "新队长已担任另一支队伍的队长。");
  await tx.insert(teamCaptainChanges).values({ teamId: team.id, fromUserId: team.captainUserId, toUserId: input.toUserId, changedAt: await nextCaptainChangeAt(tx, team.id), changedByActorId: input.actorId });
  await tx.update(teams).set({ captainUserId: input.toUserId, updatedAt: new Date() }).where(eq(teams.id, team.id));
  await auditTeam(tx, "team.captain.transfer", input.actorId, team.id, { fromUserId: team.captainUserId, toUserId: input.toUserId, emergencyOverride: input.emergencyOverride });
}

export async function disbandTeamInTx(tx: TxDb, input: { teamId: string; actorUserId: string; actorId: string; emergencyOverride: boolean }): Promise<string> {
  const team = await lockTeam(tx, input.teamId);
  if (team.captainUserId !== input.actorUserId && !input.emergencyOverride) throw new AppError(ErrorCode.FORBIDDEN, "只有当前队长可以执行此操作。");
  const [activeEntry] = await tx
    .select({ id: competitionEntries.id })
    .from(competitionEntries)
    .innerJoin(seasons, eq(seasons.id, competitionEntries.competitionId))
    .where(and(eq(competitionEntries.teamId, team.id), inArray(competitionEntries.registrationStatus, ["draft", "submitted", "changes_requested", "waitlisted", "approved"]), sql`${seasons.status} NOT IN ('finished', 'archived')`))
    .limit(1);
  if (activeEntry && !input.emergencyOverride) throw new AppError(ErrorCode.VALIDATION_FAILED, "队伍仍有进行中的赛事参赛条目，不能直接解散。");
  const now = new Date();
  await tx.update(teamMemberships).set({ status: "left", endedAt: now, endedReason: "disbanded", updatedAt: now }).where(and(eq(teamMemberships.teamId, team.id), isNull(teamMemberships.endedAt)));
  await tx.update(teams).set({ status: "disbanded", disbandedAt: now, disbandedBy: input.actorId, updatedAt: now }).where(eq(teams.id, team.id));
  await closeTeamRecruitmentForDisbandInTx(tx, team.id);
  await auditTeam(tx, "team.disband", input.actorId, team.id, { emergencyOverride: input.emergencyOverride, activeEntryId: activeEntry?.id ?? null });
  return team.slug;
}
