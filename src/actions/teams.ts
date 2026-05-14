"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { auditLogs, seasonRegistrations, seasons, teams } from "@/db/schema";
import { actionError, failValidation } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { auditActorId, requireAuth } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/auth/supabase";
import { revalidateSeasonPaths } from "@/lib/revalidation";
import { ok, type ActionResult } from "@/types/action";
import { MIN_TEAM_NAME_LENGTH, MAX_TEAM_NAME_LENGTH } from "@/lib/config/team-config";

const LOGO_BUCKET = "team-logos";
const LOGO_MAX_BYTES = 1_048_576; // 1 MB
const LOGO_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function uploadTeamLogo(
  teamId: string,
  formData: FormData,
): Promise<ActionResult<{ logoUrl: string }>> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return failValidation("未提供文件");
  }
  if (!LOGO_ALLOWED_TYPES.includes(file.type)) {
    return failValidation("请上传 JPG、PNG 或 WebP 格式的图片");
  }
  if (file.size > LOGO_MAX_BYTES) {
    return failValidation("文件大小不能超过 1 MB");
  }

  try {
    const session = await requireAuth();
    const result = await db.transaction(async (tx) => {
      const team = await tx.query.teams.findFirst({
        where: eq(teams.id, teamId),
      });
      if (!team) throw new AppError(ErrorCode.NOT_FOUND, "队伍不存在");

      const registration = await tx.query.seasonRegistrations.findFirst({
        where: and(
          eq(seasonRegistrations.seasonId, team.seasonId),
          eq(seasonRegistrations.userId, session.userId),
        ),
      });
      if (!registration || registration.id !== team.captainRegistrationId) {
        throw new AppError(ErrorCode.FORBIDDEN, "只有队长可以上传队伍图标");
      }

      const season = await tx.query.seasons.findFirst({
        where: eq(seasons.id, team.seasonId),
      });
      if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");

      return { seasonSlug: season.slug, teamSeasonId: team.seasonId };
    });

    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${teamId}/${Date.now()}.${ext}`;
    const supabase = createServiceClient();
    const { error: uploadError } = await supabase.storage
      .from(LOGO_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "图片上传失败，请重试");
    }

    const { data: urlData } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
    const logoUrl = urlData.publicUrl;

    await db.transaction(async (tx) => {
      await tx.update(teams).set({ logoUrl }).where(eq(teams.id, teamId));
      await tx.insert(auditLogs).values({
        seasonId: result.teamSeasonId,
        action: "team.upload_logo",
        actorId: auditActorId(session),
        targetId: teamId,
        targetType: "team",
        meta: { logoUrl },
      });
    });

    revalidateSeasonPaths(result.seasonSlug, ["teams"]);
    revalidatePath(`/${result.seasonSlug}/teams/${teamId}`);

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

      const registration = await tx.query.seasonRegistrations.findFirst({
        where: and(
          eq(seasonRegistrations.seasonId, team.seasonId),
          eq(seasonRegistrations.userId, session.userId),
        ),
      });
      if (!registration || registration.id !== team.captainRegistrationId) {
        throw new AppError(ErrorCode.FORBIDDEN, "只有队长可以修改队伍名称");
      }

      const season = await tx.query.seasons.findFirst({
        where: eq(seasons.id, team.seasonId),
      });
      if (!season) {
        throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
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
