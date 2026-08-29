"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { auditLogs, seasons, teams } from "@/db/schema";
import { actionError, failValidation } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { auditActorId, requireAuth, requireSeasonAdmin } from "@/lib/auth/session";
import { majorPrestartEntrants } from "@/db/schema";
import { teamMembers } from "@/db/schema";
import { createServiceClient } from "@/lib/auth/supabase";
import { revalidateSeasonPaths } from "@/lib/revalidation";
import { ok, type ActionResult } from "@/types/action";
import { MIN_TEAM_NAME_LENGTH, MAX_TEAM_NAME_LENGTH } from "@/lib/config/team-config";
import { LOGO_MAX_BYTES, LOGO_ALLOWED_TYPES } from "@/lib/config/upload-limits";
import { TEAM_LOGO_BUCKET, TEAM_LOGO_EXTENSIONS } from "@/lib/config/team-logo";


export async function uploadTeamLogo(
  teamId: string,
  formData: FormData,
): Promise<ActionResult<{ logoUrl: string }>> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return failValidation("未提供文件");
  }
  if (!(LOGO_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return failValidation("请上传 JPG、PNG 或 WebP 格式的图片");
  }
  if (file.size > LOGO_MAX_BYTES) {
    return failValidation("文件大小不能超过 1 MB");
  }

  try {
    const session = await requireAuth();

    // 并行读取：team 先取，season 依赖 team.seasonId
    const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
    if (!team) throw new AppError(ErrorCode.NOT_FOUND, "队伍不存在");

    if (team.captainUserId !== session.userId) {
      throw new AppError(ErrorCode.FORBIDDEN, "只有队长可以上传队伍图标");
    }
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, team.seasonId) });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");

    const ext = TEAM_LOGO_EXTENSIONS[file.type] ?? "jpg";
    const path = `${teamId}/${Date.now()}.${ext}`;
    const supabase = createServiceClient();
    const bucket = supabase.storage.from(TEAM_LOGO_BUCKET);
    const { error: uploadError } = await bucket.upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "图片上传失败，请重试");
    }

    const { data: urlData } = bucket.getPublicUrl(path);
    const logoUrl = urlData.publicUrl;

    await db.transaction(async (tx) => {
      await tx.update(teams).set({ logoUrl }).where(eq(teams.id, teamId));
      await tx.insert(auditLogs).values({
        seasonId: team.seasonId,
        action: "team.upload_logo",
        actorId: auditActorId(session),
        targetId: teamId,
        targetType: "team",
        meta: { logoUrl },
      });
    });

    revalidateSeasonPaths(season.slug, ["teams"]);
    revalidatePath(`/${season.slug}/teams/${teamId}`);

    return ok({ logoUrl });
  } catch (e) {
    return actionError("uploadTeamLogo", e);
  }
}

export async function updateTeamName(
  teamId: string,
  rawName: string,
): Promise<ActionResult<void>> {
  const name = rawName.trim();
  if (name.length < MIN_TEAM_NAME_LENGTH || name.length > MAX_TEAM_NAME_LENGTH) {
    return failValidation(`队伍名称需为 ${MIN_TEAM_NAME_LENGTH}-${MAX_TEAM_NAME_LENGTH} 个字符`);
  }

  try {
    const session = await requireAuth();
    const result = await db.transaction(async (tx) => {
      const team = await tx.query.teams.findFirst({
        where: eq(teams.id, teamId),
      });
      if (!team) {
        throw new AppError(ErrorCode.NOT_FOUND, "队伍不存在");
      }

      if (team.captainUserId !== session.userId) {
        throw new AppError(ErrorCode.FORBIDDEN, "只有队长可以修改队伍名称");
      }

      const season = await tx.query.seasons.findFirst({
        where: eq(seasons.id, team.seasonId),
      });
      if (!season) {
        throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
      }

      // bracket 已初始化后禁止改名：participant identity 依赖队名，改名会破坏淘汰赛映射
      if (season.bracketData) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          "赛程已生成，当前版本无法安全修改队名；修改可能破坏淘汰赛身份映射。"
        );
      }

      if (team.name !== name) {
        await tx.update(teams).set({ name }).where(eq(teams.id, team.id));
        await tx.insert(auditLogs).values({
          seasonId: team.seasonId,
          action: "team.rename",
          actorId: auditActorId(session),
          targetId: team.id,
          targetType: "team",
          meta: { from: team.name, to: name },
        });
      }

      return { seasonSlug: season.slug };
    });

    revalidateSeasonPaths(result.seasonSlug, ["teams", "draft", "draftCaptain"]);
    revalidatePath(`/${result.seasonSlug}/teams/${teamId}`);

    return ok(undefined);
  } catch (e) {
    return actionError("updateTeamName", e);
  }
}

export async function transferTeamCaptain(input: { teamId: string; toUserId: string }): Promise<ActionResult<void>> {
  if (!input || !/^[0-9a-f-]{36}$/i.test(input.teamId) || !/^[0-9a-f-]{36}$/i.test(input.toUserId)) return failValidation("队长交接信息无效。");
  try {
    const session = await requireAuth();
    const team = await db.query.teams.findFirst({ where: eq(teams.id, input.teamId) });
    if (!team) throw new AppError(ErrorCode.NOT_FOUND, "队伍不存在。");
    let emergencyOverride = false;
    if (team.captainUserId !== session.userId) { await requireSeasonAdmin(team.seasonId); emergencyOverride = true; }
    const season = await db.query.seasons.findFirst({ where: eq(seasons.id, team.seasonId) });
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。");
    const entrant = await db.query.majorPrestartEntrants.findFirst({ where: and(eq(majorPrestartEntrants.seasonId, team.seasonId), eq(majorPrestartEntrants.teamId, team.id)), columns: { rosterConfirmedAt: true } });
    if (!emergencyOverride && (season.status !== "registration" || entrant?.rosterConfirmedAt)) throw new AppError(ErrorCode.VALIDATION_FAILED, "正式名单已锁定或赛事已进入赛务阶段，只有管理员可以执行队长交接。");
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM teams WHERE id = ${team.id} FOR UPDATE`);
      const member = await tx.query.teamMembers.findFirst({ where: and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, input.toUserId)) });
      if (!member) throw new AppError(ErrorCode.VALIDATION_FAILED, "新队长必须是当前正式队伍成员。");
      await tx.update(teams).set({ captainUserId: input.toUserId }).where(eq(teams.id, team.id));
      await tx.insert(auditLogs).values({ seasonId: team.seasonId, action: "team.transfer_captain", actorId: auditActorId(session), targetId: team.id, targetType: "team", meta: { fromUserId: team.captainUserId, toUserId: input.toUserId, emergencyOverride } });
    });
    revalidateSeasonPaths(season.slug, ["teams", "draft", "draftCaptain"]);
    return ok(undefined);
  } catch (error) { return actionError("transferTeamCaptain", error); }
}
