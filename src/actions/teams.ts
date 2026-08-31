"use server";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, count, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import {
  auditLogs,
  competitionEntries,
  seasons,
  teamCaptainTenures,
  teamInvitations,
  teamMemberships,
  teamNameHistory,
  teamSlugAliases,
  teams,
  users,
} from "@/db/schema";
import { actionError, failValidation, isPgUniqueViolation } from "@/lib/action-utils";
import { auditActorId, requireAuth, requireSuperAdmin } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/auth/supabase";
import { MAX_TEAM_NAME_LENGTH, MIN_TEAM_NAME_LENGTH } from "@/lib/config/team-config";
import { AppError, ErrorCode } from "@/lib/errors";
import { TEAM_LOGO_BUCKET, TEAM_LOGO_EXTENSIONS } from "@/lib/config/team-logo";
import { LOGO_ALLOWED_TYPES, LOGO_MAX_BYTES } from "@/lib/config/upload-limits";
import { normalizeEmail } from "@/lib/utils/email";
import { acceptTeamInvitationInTx, expirePendingInvitationsInTx } from "@/lib/teams/invitations";
import { fail, ok, type ActionResult } from "@/types/action";

const uuid = z.string().uuid();
const teamName = z.string().trim().min(MIN_TEAM_NAME_LENGTH).max(MAX_TEAM_NAME_LENGTH);
const description = z.string().trim().max(500);
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INVITE_RATE_LIMIT_PER_HOUR = 20;

type TeamTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function invalid(message: string): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message });
}

function slugBase(name: string): string {
  return name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36);
}

function slugFor(name: string, id: string): string {
  return `${slugBase(name) || "team"}-${id.slice(0, 8)}`;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function revalidateTeam(slug?: string): void {
  revalidatePath("/teams");
  revalidatePath("/my/teams");
  if (slug) revalidatePath(`/teams/${slug}`);
}

async function lockTeam(tx: TeamTx, teamId: string) {
  const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
  if (!team) throw new AppError(ErrorCode.NOT_FOUND, "队伍不存在。");
  return team;
}

async function requireLockedCaptain(tx: TeamTx, teamId: string, userId: string) {
  const team = await lockTeam(tx, teamId);
  if (team.status !== "active") throw new AppError(ErrorCode.VALIDATION_FAILED, "队伍已解散。");
  if (team.captainUserId !== userId) throw new AppError(ErrorCode.FORBIDDEN, "只有当前队长可以执行此操作。");
  return team;
}

async function auditTeam(tx: TeamTx, action: string, actorId: string, teamId: string, meta?: Record<string, unknown>) {
  await tx.insert(auditLogs).values({ seasonId: null, action, actorId, targetId: teamId, targetType: "team", meta: meta ?? null });
}

export async function createTeam(input: { name: string; description?: string }): Promise<ActionResult<{ teamId: string; slug: string }>> {
  const parsed = z.object({ name: teamName, description: description.optional() }).safeParse(input);
  if (!parsed.success) return invalid(`队伍名称需为 ${MIN_TEAM_NAME_LENGTH}-${MAX_TEAM_NAME_LENGTH} 个字符，简介不超过 500 字。`);
  try {
    const session = await requireAuth();
    const id = randomUUID();
    const slug = slugFor(parsed.data.name, id);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM users WHERE id = ${session.userId} FOR UPDATE`);
      const currentCaptaincy = await tx.query.teams.findFirst({ where: and(eq(teams.captainUserId, session.userId), eq(teams.status, "active")) });
      if (currentCaptaincy) throw new AppError(ErrorCode.VALIDATION_FAILED, "你已担任一支队伍的队长；请先完成队长交接。");
      const currentActive = await tx.query.teamMemberships.findFirst({ where: and(eq(teamMemberships.userId, session.userId), eq(teamMemberships.status, "active"), isNull(teamMemberships.endedAt)) });
      if (currentActive) throw new AppError(ErrorCode.VALIDATION_FAILED, "你已在一支长期队伍中处于 active；请先变更原成员状态。");
      await tx.insert(teams).values({ id, slug, name: parsed.data.name, description: parsed.data.description || null, creatorUserId: session.userId, captainUserId: session.userId });
      await tx.insert(teamMemberships).values({ teamId: id, userId: session.userId, role: "captain", status: "active", invitedByUserId: session.userId });
      await tx.insert(teamCaptainTenures).values({ teamId: id, userId: session.userId, transferredBy: auditActorId(session) });
      await tx.insert(teamNameHistory).values({ teamId: id, name: parsed.data.name, changedBy: auditActorId(session) });
      await auditTeam(tx, "team.create", auditActorId(session), id, { name: parsed.data.name, creatorUserId: session.userId });
    });
    revalidateTeam(slug);
    return ok({ teamId: id, slug });
  } catch (error) {
    if (isPgUniqueViolation(error)) return invalid("你当前已有 active 队伍或队长身份。");
    return actionError("createTeam", error);
  }
}

export async function updateTeamProfile(input: { teamId: string; name: string; description?: string; recruiting: boolean }): Promise<ActionResult<{ slug: string }>> {
  const parsed = z.object({ teamId: uuid, name: teamName, description: description.optional(), recruiting: z.boolean() }).safeParse(input);
  if (!parsed.success) return invalid("队伍资料无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction(async (tx) => {
      const team = await requireLockedCaptain(tx, parsed.data.teamId, session.userId);
      const nameChanged = team.name !== parsed.data.name;
      const nextSlug = nameChanged ? slugFor(parsed.data.name, team.id) : team.slug;
      if (nameChanged) {
        await tx.update(teamNameHistory).set({ endedAt: new Date() }).where(and(eq(teamNameHistory.teamId, team.id), isNull(teamNameHistory.endedAt)));
        await tx.insert(teamNameHistory).values({ teamId: team.id, name: parsed.data.name, changedBy: auditActorId(session) });
        await tx.insert(teamSlugAliases).values({ slug: team.slug, teamId: team.id }).onConflictDoNothing();
      }
      await tx.update(teams).set({ name: parsed.data.name, slug: nextSlug, description: parsed.data.description || null, recruiting: parsed.data.recruiting, updatedAt: new Date() }).where(eq(teams.id, team.id));
      await auditTeam(tx, "team.update_profile", auditActorId(session), team.id, { fromName: team.name, toName: parsed.data.name, recruiting: parsed.data.recruiting });
      return { oldSlug: team.slug, slug: nextSlug };
    });
    revalidateTeam(result.oldSlug);
    revalidateTeam(result.slug);
    return ok({ slug: result.slug });
  } catch (error) { return actionError("updateTeamProfile", error); }
}

export async function uploadTeamLogo(teamId: string, formData: FormData): Promise<ActionResult<{ logoUrl: string }>> {
  const file = formData.get("file");
  if (!(file instanceof File)) return failValidation("未提供文件");
  if (!(LOGO_ALLOWED_TYPES as readonly string[]).includes(file.type)) return failValidation("请上传 JPG、PNG 或 WebP 格式的图片");
  if (file.size > LOGO_MAX_BYTES) return failValidation("文件大小不能超过 1 MB");
  try {
    const session = await requireAuth();
    const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
    if (!team || team.status !== "active") throw new AppError(ErrorCode.NOT_FOUND, "队伍不存在或已解散。");
    if (team.captainUserId !== session.userId) throw new AppError(ErrorCode.FORBIDDEN, "只有当前队长可以上传队伍 Logo。");
    const extension = TEAM_LOGO_EXTENSIONS[file.type] ?? "jpg";
    const path = `${teamId}/${Date.now()}.${extension}`;
    const bucket = createServiceClient().storage.from(TEAM_LOGO_BUCKET);
    const { error } = await bucket.upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw new AppError(ErrorCode.INTERNAL_ERROR, "图片上传失败，请重试。");
    const logoUrl = bucket.getPublicUrl(path).data.publicUrl;
    await db.transaction(async (tx) => {
      const locked = await requireLockedCaptain(tx, teamId, session.userId);
      await tx.update(teams).set({ logoUrl, updatedAt: new Date() }).where(eq(teams.id, teamId));
      await auditTeam(tx, "team.logo.update", auditActorId(session), teamId, { from: locked.logoUrl, to: logoUrl });
    });
    revalidateTeam(team.slug);
    return ok({ logoUrl });
  } catch (error) { return actionError("uploadTeamLogo", error); }
}

async function assertInviteRate(tx: TeamTx, teamId: string): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const [{ value }] = await tx.select({ value: count() }).from(teamInvitations).where(and(eq(teamInvitations.teamId, teamId), gte(teamInvitations.createdAt, since)));
  if (Number(value) >= INVITE_RATE_LIMIT_PER_HOUR) throw new AppError(ErrorCode.VALIDATION_FAILED, "邀请过于频繁，请稍后再试。");
}

export async function inviteTeamMember(input: { teamId: string; email: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ teamId: uuid, email: z.string().email() }).safeParse(input);
  if (!parsed.success) return invalid("请输入已注册用户的有效邮箱。");
  try {
    const session = await requireAuth();
    const user = await db.query.users.findFirst({ where: eq(users.email, normalizeEmail(parsed.data.email)) });
    if (!user) throw new AppError(ErrorCode.NOT_FOUND, "该邮箱尚未注册 RivalHub。");
    await db.transaction(async (tx) => {
      const team = await requireLockedCaptain(tx, parsed.data.teamId, session.userId);
      await assertInviteRate(tx, team.id);
      const current = await tx.query.teamMemberships.findFirst({ where: and(eq(teamMemberships.teamId, team.id), eq(teamMemberships.userId, user.id), isNull(teamMemberships.endedAt)) });
      if (current) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "该用户当前已属于这支队伍。");
      // 先把已过期的 pending direct 邀请收敛为 expired，再创建新邀请，
      // 否则不再展示的过期邀请会永久占用 pending 身份并阻断重新邀请。
      const expiredCount = await expirePendingInvitationsInTx(tx, { teamId: team.id, invitedUserId: user.id });
      await tx.insert(teamInvitations).values({ teamId: team.id, kind: "direct", invitedUserId: user.id, invitedByUserId: session.userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
      await auditTeam(tx, "team.invite", auditActorId(session), team.id, { invitedUserId: user.id, kind: "direct", expiredSuperseded: expiredCount });
    });
    revalidateTeam();
    return ok(undefined);
  } catch (error) {
    if (isPgUniqueViolation(error)) return invalid("该邀请已存在。");
    return actionError("inviteTeamMember", error);
  }
}

export async function createTeamShareInvitation(input: { teamId: string }): Promise<ActionResult<{ token: string; expiresAt: string }>> {
  const parsed = z.object({ teamId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("队伍标识无效。");
  try {
    const session = await requireAuth();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await db.transaction(async (tx) => {
      const team = await requireLockedCaptain(tx, parsed.data.teamId, session.userId);
      await assertInviteRate(tx, team.id);
      await tx.insert(teamInvitations).values({ teamId: team.id, kind: "share_link", tokenHash: tokenHash(token), invitedByUserId: session.userId, expiresAt });
      await auditTeam(tx, "team.invite", auditActorId(session), team.id, { kind: "share_link", expiresAt: expiresAt.toISOString() });
    });
    return ok({ token, expiresAt: expiresAt.toISOString() });
  } catch (error) { return actionError("createTeamShareInvitation", error); }
}

export async function acceptTeamInvitation(input: { invitationId?: string; token?: string }): Promise<ActionResult<{ teamId: string; slug: string }>> {
  const parsed = z.object({ invitationId: uuid.optional(), token: z.string().min(32).optional() }).refine((value) => Boolean(value.invitationId) !== Boolean(value.token)).safeParse(input);
  if (!parsed.success) return invalid("邀请标识无效。");
  try {
    const session = await requireAuth();
    const result = await db.transaction((tx) => acceptTeamInvitationInTx(tx, {
      userId: session.userId,
      actorId: auditActorId(session),
      invitationId: parsed.data.invitationId,
      tokenHash: parsed.data.token ? tokenHash(parsed.data.token) : undefined,
    }));
    if (result.kind === "expired") {
      // 事务已正常提交并把邀请持久化为 expired；在这里才转成业务失败。
      return fail({ code: ErrorCode.VALIDATION_FAILED, message: "邀请已过期。" });
    }
    revalidateTeam(result.slug);
    return ok(result);
  } catch (error) {
    if (isPgUniqueViolation(error)) return invalid("你当前已有 active 队伍。");
    return actionError("acceptTeamInvitation", error);
  }
}

export async function declineTeamInvitation(input: { invitationId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ invitationId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("邀请标识无效。");
  try {
    const session = await requireAuth();
    await db.transaction(async (tx) => {
      const [invitation] = await tx.select().from(teamInvitations).where(eq(teamInvitations.id, parsed.data.invitationId)).for("update");
      if (!invitation || invitation.kind !== "direct" || invitation.invitedUserId !== session.userId || invitation.status !== "pending") throw new AppError(ErrorCode.NOT_FOUND, "邀请不存在或已失效。");
      await tx.update(teamInvitations).set({ status: "declined", respondedAt: new Date(), updatedAt: new Date() }).where(eq(teamInvitations.id, invitation.id));
      await auditTeam(tx, "team.invite.decline", auditActorId(session), invitation.teamId, { invitationId: invitation.id });
    });
    revalidateTeam();
    return ok(undefined);
  } catch (error) { return actionError("declineTeamInvitation", error); }
}

export async function revokeTeamInvitation(input: { teamId: string; invitationId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ teamId: uuid, invitationId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("邀请标识无效。");
  try {
    const session = await requireAuth();
    await db.transaction(async (tx) => {
      await requireLockedCaptain(tx, parsed.data.teamId, session.userId);
      const [invitation] = await tx.select().from(teamInvitations).where(and(eq(teamInvitations.id, parsed.data.invitationId), eq(teamInvitations.teamId, parsed.data.teamId))).for("update");
      if (!invitation || invitation.status !== "pending") throw new AppError(ErrorCode.NOT_FOUND, "待处理邀请不存在。");
      await tx.update(teamInvitations).set({ status: "revoked", respondedAt: new Date(), updatedAt: new Date() }).where(eq(teamInvitations.id, invitation.id));
      await auditTeam(tx, "team.invite.revoke", auditActorId(session), parsed.data.teamId, { invitationId: invitation.id });
    });
    revalidateTeam();
    return ok(undefined);
  } catch (error) { return actionError("revokeTeamInvitation", error); }
}

export async function setTeamMembershipStatus(input: { teamId: string; userId: string; status: "active" | "benched" }): Promise<ActionResult<void>> {
  const parsed = z.object({ teamId: uuid, userId: uuid, status: z.enum(["active", "benched"]) }).safeParse(input);
  if (!parsed.success) return invalid("成员状态无效。");
  try {
    const session = await requireAuth();
    await db.transaction(async (tx) => {
      const team = await requireLockedCaptain(tx, parsed.data.teamId, session.userId);
      if (parsed.data.userId === team.captainUserId && parsed.data.status !== "active") throw new AppError(ErrorCode.VALIDATION_FAILED, "队长必须先完成交接，才能变为非 active。");
      await tx.execute(sql`SELECT id FROM users WHERE id = ${parsed.data.userId} FOR UPDATE`);
      const [membership] = await tx.select().from(teamMemberships).where(and(eq(teamMemberships.teamId, team.id), eq(teamMemberships.userId, parsed.data.userId), isNull(teamMemberships.endedAt))).for("update");
      if (!membership) throw new AppError(ErrorCode.NOT_FOUND, "当前成员不存在。");
      if (parsed.data.status === "active") {
        const other = await tx.query.teamMemberships.findFirst({ where: and(eq(teamMemberships.userId, parsed.data.userId), eq(teamMemberships.status, "active"), isNull(teamMemberships.endedAt), ne(teamMemberships.teamId, team.id)) });
        if (other) throw new AppError(ErrorCode.VALIDATION_FAILED, "该成员已在另一支长期队伍中处于 active。");
      }
      await tx.update(teamMemberships).set({ status: parsed.data.status, updatedAt: new Date() }).where(eq(teamMemberships.id, membership.id));
      await auditTeam(tx, "team.membership.status_change", auditActorId(session), team.id, { userId: parsed.data.userId, from: membership.status, to: parsed.data.status });
    });
    revalidateTeam();
    return ok(undefined);
  } catch (error) {
    if (isPgUniqueViolation(error)) return invalid("该成员已在另一支长期队伍中处于 active。");
    return actionError("setTeamMembershipStatus", error);
  }
}

async function endMembership(tx: TeamTx, args: { teamId: string; userId: string; actorId: string; reason: "left" | "kicked" }) {
  const [membership] = await tx.select().from(teamMemberships).where(and(eq(teamMemberships.teamId, args.teamId), eq(teamMemberships.userId, args.userId), isNull(teamMemberships.endedAt))).for("update");
  if (!membership) throw new AppError(ErrorCode.NOT_FOUND, "当前成员不存在。");
  await tx.update(teamMemberships).set({ status: "left", role: "member", endedAt: new Date(), endedReason: args.reason, updatedAt: new Date() }).where(eq(teamMemberships.id, membership.id));
  await auditTeam(tx, args.reason === "left" ? "team.membership.leave" : "team.membership.kick", args.actorId, args.teamId, { userId: args.userId, previousStatus: membership.status });
}

export async function leaveTeam(input: { teamId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ teamId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("队伍标识无效。");
  try {
    const session = await requireAuth();
    await db.transaction(async (tx) => {
      const team = await lockTeam(tx, parsed.data.teamId);
      if (team.captainUserId === session.userId) throw new AppError(ErrorCode.VALIDATION_FAILED, "队长必须先完成交接才能退出。");
      await endMembership(tx, { teamId: team.id, userId: session.userId, actorId: auditActorId(session), reason: "left" });
    });
    revalidateTeam();
    return ok(undefined);
  } catch (error) { return actionError("leaveTeam", error); }
}

export async function kickTeamMember(input: { teamId: string; userId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ teamId: uuid, userId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("成员标识无效。");
  try {
    const session = await requireAuth();
    await db.transaction(async (tx) => {
      const team = await requireLockedCaptain(tx, parsed.data.teamId, session.userId);
      if (team.captainUserId === parsed.data.userId) throw new AppError(ErrorCode.VALIDATION_FAILED, "队长不能踢出自己；请先完成交接。");
      await endMembership(tx, { teamId: team.id, userId: parsed.data.userId, actorId: auditActorId(session), reason: "kicked" });
    });
    revalidateTeam();
    return ok(undefined);
  } catch (error) { return actionError("kickTeamMember", error); }
}

export async function transferTeamCaptain(input: { teamId: string; toUserId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ teamId: uuid, toUserId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("队长交接信息无效。");
  try {
    const actor = await requireAuth();
    await db.transaction(async (tx) => {
      const team = await lockTeam(tx, parsed.data.teamId);
      let adminOverride = false;
      if (team.captainUserId !== actor.userId) {
        await requireSuperAdmin();
        adminOverride = true;
      }
      await tx.execute(sql`SELECT id FROM users WHERE id IN (${team.captainUserId}, ${parsed.data.toUserId}) ORDER BY id FOR UPDATE`);
      const memberships = await tx.select().from(teamMemberships).where(and(eq(teamMemberships.teamId, team.id), inArray(teamMemberships.userId, [team.captainUserId, parsed.data.toUserId]), isNull(teamMemberships.endedAt))).for("update");
      const from = memberships.find((row) => row.userId === team.captainUserId);
      const to = memberships.find((row) => row.userId === parsed.data.toUserId);
      if (!from || !to || to.status !== "active") throw new AppError(ErrorCode.VALIDATION_FAILED, "新队长必须是该队当前 active 成员。");
      const otherCaptaincy = await tx.query.teams.findFirst({ where: and(eq(teams.captainUserId, parsed.data.toUserId), eq(teams.status, "active"), ne(teams.id, team.id)) });
      if (otherCaptaincy) throw new AppError(ErrorCode.VALIDATION_FAILED, "新队长已担任另一支队伍的队长。");
      await tx.update(teamMemberships).set({ role: "member", updatedAt: new Date() }).where(eq(teamMemberships.id, from.id));
      await tx.update(teamMemberships).set({ role: "captain", updatedAt: new Date() }).where(eq(teamMemberships.id, to.id));
      await tx.update(teamCaptainTenures).set({ endedAt: new Date() }).where(and(eq(teamCaptainTenures.teamId, team.id), isNull(teamCaptainTenures.endedAt)));
      await tx.insert(teamCaptainTenures).values({ teamId: team.id, userId: parsed.data.toUserId, transferredBy: auditActorId(actor) });
      await tx.update(teams).set({ captainUserId: parsed.data.toUserId, updatedAt: new Date() }).where(eq(teams.id, team.id));
      await auditTeam(tx, "team.captain.transfer", auditActorId(actor), team.id, { fromUserId: team.captainUserId, toUserId: parsed.data.toUserId, adminOverride });
    });
    revalidateTeam();
    return ok(undefined);
  } catch (error) {
    if (isPgUniqueViolation(error)) return invalid("新队长已担任另一支队伍的队长。");
    return actionError("transferTeamCaptain", error);
  }
}

export async function disbandTeam(input: { teamId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ teamId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("队伍标识无效。");
  try {
    const actor = await requireAuth();
    const slug = await db.transaction(async (tx) => {
      const team = await lockTeam(tx, parsed.data.teamId);
      let adminOverride = false;
      if (team.captainUserId !== actor.userId) {
        await requireSuperAdmin();
        adminOverride = true;
      }
      const [activeEntry] = await tx
        .select({ id: competitionEntries.id })
        .from(competitionEntries)
        .innerJoin(seasons, eq(seasons.id, competitionEntries.competitionId))
        .where(and(
          eq(competitionEntries.teamId, team.id),
          inArray(competitionEntries.registrationStatus, ["draft", "submitted", "changes_requested", "waitlisted", "approved"]),
          sql`${seasons.status} NOT IN ('finished', 'archived')`,
        ))
        .limit(1);
      if (activeEntry && !adminOverride) throw new AppError(ErrorCode.VALIDATION_FAILED, "队伍仍有进行中的赛事参赛条目，不能直接解散。");
      const now = new Date();
      await tx.update(teamMemberships).set({ status: "left", role: "member", endedAt: now, endedReason: "disbanded", updatedAt: now }).where(and(eq(teamMemberships.teamId, team.id), isNull(teamMemberships.endedAt)));
      await tx.update(teamCaptainTenures).set({ endedAt: now }).where(and(eq(teamCaptainTenures.teamId, team.id), isNull(teamCaptainTenures.endedAt)));
      await tx.update(teams).set({ status: "disbanded", recruiting: false, disbandedAt: now, disbandedBy: auditActorId(actor), updatedAt: now }).where(eq(teams.id, team.id));
      await auditTeam(tx, "team.disband", auditActorId(actor), team.id, { adminOverride, activeEntryId: activeEntry?.id ?? null });
      return team.slug;
    });
    revalidateTeam(slug);
    return ok(undefined);
  } catch (error) { return actionError("disbandTeam", error); }
}
