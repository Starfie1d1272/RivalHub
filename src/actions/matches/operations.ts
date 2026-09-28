"use server";

import { randomUUID } from "node:crypto";
import { and, eq, isNull, count } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { coverageAllocations, coverageHolds, officialCoverageSlots, seasons } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { writeAuditInTx } from "@/lib/audit/write";
import { actionError } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { createMizarPairing, revokeMizarInstallation } from "@/lib/mizar/installation";
import { takeOverCurrentMap } from "@/lib/mizar/source";
import { seasonPublicAssetsStorage } from "@/lib/season-public-info/storage";
import { SEASON_PUBLIC_ASSETS_BUCKET } from "@/lib/season-public-info/presentation";
import { createServiceClient } from "@/lib/auth/supabase-server";
import { revalidatePath } from "next/cache";
import { ok, type ActionResult } from "@/types/action";

const id = z.uuid();

export async function createCoverageSlot(seasonId: string, input: { startsAt: string; endsAt: string; capacity: number; note: string }): Promise<ActionResult<void>> {
  try {
    id.parse(seasonId);
    const admin = await requireSeasonAdmin(seasonId);
    const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 24 * 3600_000 || !Number.isSafeInteger(input.capacity) || input.capacity < 1 || input.capacity > 20 || input.note.length > 300) throw new AppError(ErrorCode.VALIDATION_FAILED, "请填写有效的时段和容量。");
    await db.transaction(async tx => {
      const [slot] = await tx.insert(officialCoverageSlots).values({ seasonId, startsAt, endsAt, capacity: input.capacity, note: input.note.trim() || null }).returning({ id: officialCoverageSlots.id });
      await writeAuditInTx(tx, { seasonId, actorId: admin.userId, action: "coverage.slot.create", targetId: seasonId, meta: { slotId: slot.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), capacity: input.capacity } });
    });
    const [season] = await db.select({ slug: seasons.slug }).from(seasons).where(eq(seasons.id, seasonId));
    if (season) revalidatePath(`/admin/${season.slug}/matches`);
    return ok(undefined);
  } catch (error) { return actionError("createCoverageSlot", error); }
}

export async function removeCoverageSlot(seasonId: string, slotId: string): Promise<ActionResult<void>> {
  try {
    id.parse(seasonId); id.parse(slotId);
    const admin = await requireSeasonAdmin(seasonId);
    await db.transaction(async tx => {
      const [slot] = await tx.select().from(officialCoverageSlots).where(and(eq(officialCoverageSlots.id, slotId), eq(officialCoverageSlots.seasonId, seasonId))).for("update");
      if (!slot) throw new AppError(ErrorCode.NOT_FOUND, "转播时段不存在。");
      const [allocated] = await tx.select({ total: count() }).from(coverageAllocations).where(and(eq(coverageAllocations.slotId, slotId), isNull(coverageAllocations.releasedAt)));
      const [held] = await tx.select({ total: count() }).from(coverageHolds).where(and(eq(coverageHolds.slotId, slotId), isNull(coverageHolds.releasedAt)));
      if (allocated.total || held.total) throw new AppError(ErrorCode.VALIDATION_FAILED, "时段已有比赛或临时占位，请先完成处理。");
      await tx.delete(coverageAllocations).where(eq(coverageAllocations.slotId, slotId));
      await tx.delete(coverageHolds).where(eq(coverageHolds.slotId, slotId));
      await tx.delete(officialCoverageSlots).where(eq(officialCoverageSlots.id, slotId));
      await writeAuditInTx(tx, { seasonId, actorId: admin.userId, action: "coverage.slot.delete", targetId: seasonId, meta: { slotId } });
    });
    const [season] = await db.select({ slug: seasons.slug }).from(seasons).where(eq(seasons.id, seasonId));
    if (season) revalidatePath(`/admin/${season.slug}/matches`);
    return ok(undefined);
  } catch (error) { return actionError("removeCoverageSlot", error); }
}

export async function generateMizarPairing(seasonId: string): Promise<ActionResult<{ code: string; expiresAt: string }>> {
  try {
    id.parse(seasonId);
    const admin = await requireSeasonAdmin(seasonId);
    return ok(await createMizarPairing(seasonId, admin.userId));
  } catch (error) { return actionError("generateMizarPairing", error); }
}

export async function disconnectMizar(seasonId: string, installationId: string): Promise<ActionResult<void>> {
  try {
    id.parse(seasonId); id.parse(installationId);
    const admin = await requireSeasonAdmin(seasonId);
    await revokeMizarInstallation(installationId, seasonId, admin.userId);
    const [season] = await db.select({ slug: seasons.slug }).from(seasons).where(eq(seasons.id, seasonId));
    if (season) revalidatePath(`/admin/${season.slug}/matches`);
    return ok(undefined);
  } catch (error) { return actionError("disconnectMizar", error); }
}

export async function takeOverMap(matchId: string, seasonId: string): Promise<ActionResult<void>> {
  try {
    id.parse(matchId); id.parse(seasonId);
    const admin = await requireSeasonAdmin(seasonId);
    await takeOverCurrentMap(matchId, admin.userId);
    const [season] = await db.select({ slug: seasons.slug }).from(seasons).where(eq(seasons.id, seasonId));
    if (season) revalidatePath(`/admin/${season.slug}/matches/${matchId}`);
    return ok(undefined);
  } catch (error) { return actionError("takeOverMap", error); }
}

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
    if (previousPath && new RegExp(`^${seasonId}/logo-[0-9a-f-]+\\.(png|jpg|webp)$`).test(previousPath) && previousPath !== path) {
      await seasonPublicAssetsStorage.remove(previousPath).catch(() => {});
    }
    const [season] = await db.select({ slug: seasons.slug }).from(seasons).where(eq(seasons.id, seasonId));
    if (season) { revalidatePath(`/${season.slug}`); revalidatePath(`/admin/${season.slug}/matches`); }
    return ok({ logoUrl });
  } catch (error) { return actionError("uploadSeasonLogo", error); }
}
