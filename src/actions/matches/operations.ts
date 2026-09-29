"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { writeAuditInTx } from "@/lib/audit/write";
import { actionError } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { revokeMizarInstallation } from "@/lib/mizar/installation";
import { takeOverCurrentMap } from "@/lib/mizar/source";
import { seasonPublicAssetsStorage } from "@/lib/season-public-info/storage";
import { SEASON_PUBLIC_ASSETS_BUCKET } from "@/lib/season-public-info/presentation";
import { createServiceClient } from "@/lib/auth/supabase-server";
import { revalidatePath } from "next/cache";
import { ok, type ActionResult } from "@/types/action";

const id = z.uuid();

async function seasonSlug(seasonId: string): Promise<string | null> {
  const [season] = await db.select({ slug: seasons.slug }).from(seasons).where(eq(seasons.id, seasonId));
  return season?.slug ?? null;
}

/** Canonical human revoke path for one Mizar installation. Machine disconnect shares the same owner. */
export async function disconnectMizar(seasonId: string, installationId: string): Promise<ActionResult<void>> {
  try {
    id.parse(seasonId); id.parse(installationId);
    const admin = await requireSeasonAdmin(seasonId);
    await revokeMizarInstallation(installationId, seasonId, admin.userId);
    const slug = await seasonSlug(seasonId);
    if (slug) revalidatePath(`/admin/${slug}/matches`);
    return ok(undefined);
  } catch (error) { return actionError("disconnectMizar", error); }
}

/** Manual takeover is scoped to the current map execution of one match. */
export async function takeOverMap(matchId: string, seasonId: string): Promise<ActionResult<void>> {
  try {
    id.parse(matchId); id.parse(seasonId);
    const admin = await requireSeasonAdmin(seasonId);
    await takeOverCurrentMap(matchId, admin.userId);
    const slug = await seasonSlug(seasonId);
    if (slug) revalidatePath(`/admin/${slug}/matches/${matchId}`);
    return ok(undefined);
  } catch (error) { return actionError("takeOverMap", error); }
}

/** Canonical writer for the season logo projected into Tournament Context. */
export async function uploadSeasonLogo(seasonId: string, formData: FormData): Promise<ActionResult<{ logoUrl: string }>> {
  try {
    id.parse(seasonId);
    const admin = await requireSeasonAdmin(seasonId);
    const file = formData.get("file");
    if (!(file instanceof File) || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 1024 * 1024) throw new AppError(ErrorCode.VALIDATION_FAILED, "请上传不超过 1 MB 的 PNG、JPG 或 WebP 图片。");
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${seasonId}/logo-${randomUUID()}.${ext}`;
    await seasonPublicAssetsStorage.upload(path, file, file.type);
    const logoUrl = createServiceClient().storage.from(SEASON_PUBLIC_ASSETS_BUCKET).getPublicUrl(path).data.publicUrl;
    let previousLogoUrl: string | null;
    try {
      previousLogoUrl = await db.transaction(async tx => {
        const [current] = await tx.select({ logoUrl: seasons.logoUrl }).from(seasons).where(eq(seasons.id, seasonId)).for("update");
        if (!current) throw new AppError(ErrorCode.NOT_FOUND, "赛事不存在。");
        await tx.update(seasons).set({ logoUrl, updatedAt: new Date() }).where(eq(seasons.id, seasonId));
        await writeAuditInTx(tx, { seasonId, actorId: admin.userId, action: "season.logo.upload", targetId: seasonId, meta: { path } });
        return current.logoUrl;
      });
    } catch (error) { await seasonPublicAssetsStorage.remove(path); throw error; }
    const baseUrl = logoUrl.slice(0, -path.length);
    const previousPath = previousLogoUrl?.startsWith(baseUrl) ? previousLogoUrl.slice(baseUrl.length) : null;
    const [previousSeasonId, previousFilename, ...previousPathRemainder] = previousPath?.split("/") ?? [];
    const isPreviousSeasonLogo = previousPath
      && previousSeasonId === seasonId
      && previousPathRemainder.length === 0
      && /^logo-[0-9a-f-]+\.(png|jpg|webp)$/.test(previousFilename ?? "");
    if (isPreviousSeasonLogo && previousPath !== path) {
      await seasonPublicAssetsStorage.remove(previousPath).catch(() => {});
    }
    const slug = await seasonSlug(seasonId);
    if (slug) { revalidatePath(`/${slug}`); revalidatePath(`/admin/${slug}/matches`); }
    return ok({ logoUrl });
  } catch (error) { return actionError("uploadSeasonLogo", error); }
}
