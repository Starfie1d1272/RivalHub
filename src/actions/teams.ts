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
import { LOGO_MAX_BYTES, LOGO_ALLOWED_TYPES } from "@/lib/config/upload-limits";

const LOGO_BUCKET = "team-logos";
const EXT_MAP: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

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

    // 并行读取：team 先取，registration + season 依赖 team.seasonId 再并行
    const team = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
    if (!team) throw new AppError(ErrorCode.NOT_FOUND, "队伍不存在");

    const [registration, season] = await Promise.all([
      db.query.seasonRegistrations.findFirst({
        where: and(
          eq(seasonRegistrations.seasonId, team.seasonId),
          eq(seasonRegistrations.userId, session.userId),
        ),
      }),
      db.query.seasons.findFirst({ where: eq(seasons.id, team.seasonId) }),
    ]);
    if (!registration || registration.id !== team.captainRegistrationId) {
      throw new AppError(ErrorCode.FORBIDDEN, "只有队长可以上传队伍图标");
    }
    if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");

    const ext = EXT_MAP[file.type] ?? "jpg";
    const path = `${teamId}/${Date.now()}.${ext}`;
    const supabase = createServiceClient();
    const bucket = supabase.storage.from(LOGO_BUCKET);
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
