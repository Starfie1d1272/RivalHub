"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { teams, users } from "@/db/schema";
import { actionError, failValidation, isPgUniqueViolation } from "@/lib/action-utils";
import { auditActorId, requireActorWithRootFallback, requireAuth, requireSuperAdmin } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/auth/supabase";
import { MAX_TEAM_NAME_LENGTH, MIN_TEAM_NAME_LENGTH } from "@/lib/config/team-config";
import { AppError, ErrorCode } from "@/lib/errors";
import { TEAM_LOGO_BUCKET, TEAM_LOGO_EXTENSIONS } from "@/lib/config/team-logo";
import { LOGO_ALLOWED_TYPES, LOGO_MAX_BYTES } from "@/lib/config/upload-limits";
import { normalizeEmail } from "@/lib/utils/email";
import { acceptTeamInvitationInTx } from "@/lib/teams/invitations";
import {
  createTeamInTx,
  createTeamShareInvitationInTx,
  declineTeamInvitationInTx,
  disbandTeamInTx,
  inviteTeamMemberInTx,
  kickTeamMemberInTx,
  leaveTeamInTx,
  revokeTeamInvitationInTx,
  setTeamMembershipStatusInTx,
  transferTeamCaptainInTx,
  updateTeamLogoInTx,
  updateTeamProfileInTx,
  hashTeamInvitationToken,
} from "@/lib/teams/commands";
import { fail, ok, type ActionResult } from "@/types/action";

const uuid = z.string().uuid();
const teamName = z.string().trim().min(MIN_TEAM_NAME_LENGTH).max(MAX_TEAM_NAME_LENGTH);
const description = z.string().trim().max(500);
function invalid(message: string): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message });
}

function revalidateTeam(slug?: string): void {
  revalidatePath("/teams");
  revalidatePath("/my/teams");
  if (slug) revalidatePath(`/teams/${slug}`);
}

export async function createTeam(input: { name: string; description?: string }): Promise<ActionResult<{ teamId: string; slug: string }>> {
  const parsed = z.object({ name: teamName, description: description.optional() }).safeParse(input);
  if (!parsed.success) return invalid(`队伍名称需为 ${MIN_TEAM_NAME_LENGTH}-${MAX_TEAM_NAME_LENGTH} 个字符，简介不超过 500 字。`);
  try {
    const session = await requireAuth();
    const result = await db.transaction((tx) => createTeamInTx(tx, { name: parsed.data.name, description: parsed.data.description, userId: session.userId, actorId: auditActorId(session) }));
    revalidateTeam(result.slug);
    return ok(result);
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
    const result = await db.transaction((tx) => updateTeamProfileInTx(tx, { ...parsed.data, description: parsed.data.description, userId: session.userId, actorId: auditActorId(session) }));
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
    const result = await db.transaction((tx) => updateTeamLogoInTx(tx, { teamId, userId: session.userId, actorId: auditActorId(session), logoUrl }));
    revalidateTeam(result.slug);
    return ok({ logoUrl });
  } catch (error) { return actionError("uploadTeamLogo", error); }
}

export async function inviteTeamMember(input: { teamId: string; email: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ teamId: uuid, email: z.string().email() }).safeParse(input);
  if (!parsed.success) return invalid("请输入已注册用户的有效邮箱。");
  try {
    const session = await requireAuth();
    const user = await db.query.users.findFirst({ where: eq(users.email, normalizeEmail(parsed.data.email)) });
    if (!user) throw new AppError(ErrorCode.NOT_FOUND, "该邮箱尚未注册 RivalHub。");
    await db.transaction((tx) => inviteTeamMemberInTx(tx, { teamId: parsed.data.teamId, userId: session.userId, invitedUserId: user.id, actorId: auditActorId(session) }));
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
    const result = await db.transaction((tx) => createTeamShareInvitationInTx(tx, { teamId: parsed.data.teamId, userId: session.userId, actorId: auditActorId(session) }));
    return ok(result);
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
      tokenHash: parsed.data.token ? hashTeamInvitationToken(parsed.data.token) : undefined,
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
    await db.transaction((tx) => declineTeamInvitationInTx(tx, { invitationId: parsed.data.invitationId, userId: session.userId, actorId: auditActorId(session) }));
    revalidateTeam();
    return ok(undefined);
  } catch (error) { return actionError("declineTeamInvitation", error); }
}

export async function revokeTeamInvitation(input: { teamId: string; invitationId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ teamId: uuid, invitationId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("邀请标识无效。");
  try {
    const session = await requireAuth();
    await db.transaction((tx) => revokeTeamInvitationInTx(tx, { ...parsed.data, userId: session.userId, actorId: auditActorId(session) }));
    revalidateTeam();
    return ok(undefined);
  } catch (error) { return actionError("revokeTeamInvitation", error); }
}

export async function setTeamMembershipStatus(input: { teamId: string; userId: string; status: "active" | "benched" }): Promise<ActionResult<void>> {
  const parsed = z.object({ teamId: uuid, userId: uuid, status: z.enum(["active", "benched"]) }).safeParse(input);
  if (!parsed.success) return invalid("成员状态无效。");
  try {
    const session = await requireAuth();
    await db.transaction((tx) => setTeamMembershipStatusInTx(tx, { teamId: parsed.data.teamId, userId: session.userId, targetUserId: parsed.data.userId, status: parsed.data.status, actorId: auditActorId(session) }));
    revalidateTeam();
    return ok(undefined);
  } catch (error) {
    if (isPgUniqueViolation(error)) return invalid("该成员已在另一支长期队伍中处于 active。");
    return actionError("setTeamMembershipStatus", error);
  }
}

export async function leaveTeam(input: { teamId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ teamId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("队伍标识无效。");
  try {
    const session = await requireAuth();
    await db.transaction((tx) => leaveTeamInTx(tx, { teamId: parsed.data.teamId, userId: session.userId, actorId: auditActorId(session) }));
    revalidateTeam();
    return ok(undefined);
  } catch (error) { return actionError("leaveTeam", error); }
}

export async function kickTeamMember(input: { teamId: string; userId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ teamId: uuid, userId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("成员标识无效。");
  try {
    const session = await requireAuth();
    await db.transaction((tx) => kickTeamMemberInTx(tx, { teamId: parsed.data.teamId, userId: session.userId, targetUserId: parsed.data.userId, actorId: auditActorId(session) }));
    revalidateTeam();
    return ok(undefined);
  } catch (error) { return actionError("kickTeamMember", error); }
}

export async function transferTeamCaptain(input: { teamId: string; toUserId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ teamId: uuid, toUserId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("队长交接信息无效。");
  try {
    const actor = await requireActorWithRootFallback();
    const currentTeam = await db.query.teams.findFirst({ where: eq(teams.id, parsed.data.teamId), columns: { captainUserId: true } });
    const emergencyOverride = Boolean(currentTeam && currentTeam.captainUserId !== actor.userId);
    if (emergencyOverride) await requireSuperAdmin();
    await db.transaction((tx) => transferTeamCaptainInTx(tx, { teamId: parsed.data.teamId, actorUserId: actor.userId, toUserId: parsed.data.toUserId, actorId: actor.actorId, emergencyOverride }));
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
    const actor = await requireActorWithRootFallback();
    const currentTeam = await db.query.teams.findFirst({ where: eq(teams.id, parsed.data.teamId), columns: { captainUserId: true } });
    const emergencyOverride = Boolean(currentTeam && currentTeam.captainUserId !== actor.userId);
    if (emergencyOverride) await requireSuperAdmin();
    const slug = await db.transaction((tx) => disbandTeamInTx(tx, { teamId: parsed.data.teamId, actorUserId: actor.userId, actorId: actor.actorId, emergencyOverride }));
    revalidateTeam(slug);
    return ok(undefined);
  } catch (error) { return actionError("disbandTeam", error); }
}
