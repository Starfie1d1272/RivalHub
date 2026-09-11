"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { communityGroups, seasonContacts, seasons } from "@/db/schema";
import { actionError, failValidation } from "@/lib/action-utils";
import { auditActorId, requireAdmin } from "@/lib/auth/session";
import { LOGO_ALLOWED_TYPES, LOGO_MAX_BYTES } from "@/lib/config/upload-limits";
import { assertSeasonAccess, createCommunityGroupInTx, createSeasonContactInTx, deleteCommunityGroupInTx, deleteSeasonContactInTx, moveCommunityGroupInTx, moveSeasonContactInTx, updateCommunityGroupInTx, updateSeasonContactInTx, upsertSeasonPublicInfoInTx } from "@/lib/season-public-info/commands";
import { isSafePublicHref } from "@/lib/season-public-info/presentation";
import { seasonPublicAssetsStorage } from "@/lib/season-public-info/storage";
import { fail, ok, type ActionResult } from "@/types/action";

const uuid = z.guid();
const hrefSchema = z.string().trim().max(1000).refine(isSafePublicHref, "链接必须是站内路径或 HTTP(S) 地址。 ");
const nullableText = (max: number) => z.string().trim().max(max).transform((value) => value || null);
const nullableHref = (message: string, options?: { allowMailto?: boolean }) => nullableText(1000).refine((value) => value === null || isSafePublicHref(value, options), message);
const groupFields = z.object({
  seasonId: uuid,
  label: z.string().trim().min(1).max(100),
  audience: nullableText(100),
  groupNumber: nullableText(100),
  joinUrl: nullableHref("加入链接必须是站内路径或 HTTP(S) 地址。 "),
  note: nullableText(500),
});
const contactFields = z.object({
  seasonId: uuid,
  label: z.string().trim().min(1).max(100),
  publicName: nullableText(100),
  value: z.string().trim().min(1).max(500),
  href: nullableHref("链接必须是站内路径、HTTP(S) 或 mailto 地址。 ", { allowMailto: true }),
  note: nullableText(500),
});

function context(admin: Awaited<ReturnType<typeof requireAdmin>>) {
  return { role: admin.role === "super_admin" ? "super_admin" as const : "season_admin" as const, seasonIds: admin.seasonIds, actorId: auditActorId(admin) };
}

function revalidateSeasonInfo(seasonId?: string | null, slug?: string | null): void {
  revalidatePath("/admin/operations/season-info");
  if (slug) {
    revalidatePath(`/${slug}`);
    revalidatePath(`/${slug}/info`);
  }
}

async function seasonSlug(seasonId: string): Promise<string | null> {
  const [season] = await db.select({ slug: seasons.slug }).from(seasons).where(eq(seasons.id, seasonId)).limit(1);
  return season?.slug ?? null;
}

export async function saveSeasonPublicInfo(input: { seasonId: string; rulesLabel: string; rulesHref: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: uuid, rulesLabel: z.string().trim().min(1).max(100), rulesHref: hrefSchema }).safeParse(input);
  if (!parsed.success) return failValidation("规则入口无效，请检查名称和链接。 ");
  try {
    const admin = await requireAdmin();
    await db.transaction((tx) => upsertSeasonPublicInfoInTx(tx, context(admin), parsed.data));
    revalidateSeasonInfo(parsed.data.seasonId, await seasonSlug(parsed.data.seasonId));
    return ok(undefined);
  } catch (error) { return actionError("saveSeasonPublicInfo", error); }
}

export async function createCommunityGroup(input: { seasonId: string; label: string; audience?: string; groupNumber?: string; joinUrl?: string; note?: string }): Promise<ActionResult<{ id: string }>> {
  const parsed = groupFields.safeParse(input);
  if (!parsed.success) return failValidation("交流群信息无效。 ");
  try {
    const admin = await requireAdmin();
    const row = await db.transaction((tx) => createCommunityGroupInTx(tx, context(admin), { ...parsed.data, qrImagePath: null }));
    revalidateSeasonInfo(row.seasonId, await seasonSlug(row.seasonId));
    return ok({ id: row.id });
  } catch (error) { return actionError("createCommunityGroup", error); }
}

export async function updateCommunityGroup(input: { id: string; label: string; audience?: string; groupNumber?: string; note?: string; joinUrl?: string; status: "active" | "closed" }): Promise<ActionResult<void>> {
  const parsed = z.object({ id: uuid, label: z.string().trim().min(1).max(100), audience: nullableText(100), groupNumber: nullableText(100), joinUrl: nullableHref("加入链接必须是站内路径或 HTTP(S) 地址。 "), note: nullableText(500), status: z.enum(["active", "closed"]) }).safeParse(input);
  if (!parsed.success) return failValidation("交流群信息无效。 ");
  try {
    const admin = await requireAdmin();
    const [existing] = await db.select().from(communityGroups).where(eq(communityGroups.id, parsed.data.id)).limit(1);
    if (!existing) return fail({ code: "NOT_FOUND", message: "交流群不存在。" });
    const row = await db.transaction((tx) => updateCommunityGroupInTx(tx, context(admin), parsed.data.id, { label: parsed.data.label, audience: parsed.data.audience, groupNumber: parsed.data.groupNumber, joinUrl: parsed.data.joinUrl, note: parsed.data.note, status: parsed.data.status, qrImagePath: parsed.data.status === "closed" ? null : existing.qrImagePath }));
    if (row.oldQrImagePath && (parsed.data.status === "closed" || row.row.qrImagePath !== row.oldQrImagePath)) await seasonPublicAssetsStorage.remove(row.oldQrImagePath);
    revalidateSeasonInfo(existing.seasonId, await seasonSlug(existing.seasonId));
    return ok(undefined);
  } catch (error) { return actionError("updateCommunityGroup", error); }
}

export async function deleteCommunityGroup(id: string): Promise<ActionResult<void>> {
  if (!uuid.safeParse(id).success) return failValidation("交流群标识无效。 ");
  try {
    const admin = await requireAdmin();
    const row = await db.transaction((tx) => deleteCommunityGroupInTx(tx, context(admin), id));
    if (row.qrImagePath) await seasonPublicAssetsStorage.remove(row.qrImagePath);
    revalidateSeasonInfo(row.seasonId, await seasonSlug(row.seasonId));
    return ok(undefined);
  } catch (error) { return actionError("deleteCommunityGroup", error); }
}

export async function moveCommunityGroup(id: string, direction: "up" | "down"): Promise<ActionResult<void>> {
  if (!uuid.safeParse(id).success || !["up", "down"].includes(direction)) return failValidation("排序操作无效。 ");
  try {
    const admin = await requireAdmin();
    const row = await db.transaction((tx) => moveCommunityGroupInTx(tx, context(admin), id, direction));
    revalidateSeasonInfo(row.seasonId, await seasonSlug(row.seasonId));
    return ok(undefined);
  } catch (error) { return actionError("moveCommunityGroup", error); }
}

export async function uploadCommunityGroupQr(groupId: string, formData: FormData): Promise<ActionResult<void>> {
  const file = formData.get("file");
  if (!uuid.safeParse(groupId).success || !(file instanceof File)) return failValidation("请提供有效的二维码图片。 ");
  if (!(LOGO_ALLOWED_TYPES as readonly string[]).includes(file.type)) return failValidation("请上传 JPG、PNG 或 WebP 格式的图片。 ");
  if (file.size > LOGO_MAX_BYTES) return failValidation("二维码图片不能超过 1 MB。 ");
  try {
    const admin = await requireAdmin();
    const [group] = await db.select().from(communityGroups).where(eq(communityGroups.id, groupId)).limit(1);
    if (!group) return fail({ code: "NOT_FOUND", message: "交流群不存在。" });
    assertSeasonAccess(context(admin), group.seasonId);
    if (group.status === "closed") return failValidation("已关闭的交流群不能上传二维码，请重新启用并配置加入方式。 ");
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${group.seasonId}/community-groups/${group.id}/${Date.now()}.${extension}`;
    await seasonPublicAssetsStorage.upload(path, file, file.type);
    try {
      await db.transaction((tx) => updateCommunityGroupInTx(tx, context(admin), group.id, { label: group.label, audience: group.audience, groupNumber: group.groupNumber, joinUrl: group.joinUrl, note: group.note, status: group.status, qrImagePath: path }));
    } catch (error) {
      await seasonPublicAssetsStorage.remove(path);
      throw error;
    }
    if (group.qrImagePath) await seasonPublicAssetsStorage.remove(group.qrImagePath);
    revalidateSeasonInfo(group.seasonId, await seasonSlug(group.seasonId));
    return ok(undefined);
  } catch (error) { return actionError("uploadCommunityGroupQr", error); }
}

export async function removeCommunityGroupQr(groupId: string): Promise<ActionResult<void>> {
  if (!uuid.safeParse(groupId).success) return failValidation("交流群标识无效。 ");
  try {
    const admin = await requireAdmin();
    const [group] = await db.select().from(communityGroups).where(eq(communityGroups.id, groupId)).limit(1);
    if (!group) return fail({ code: "NOT_FOUND", message: "交流群不存在。" });
    assertSeasonAccess(context(admin), group.seasonId);
    await db.transaction((tx) => updateCommunityGroupInTx(tx, context(admin), group.id, { label: group.label, audience: group.audience, groupNumber: group.groupNumber, joinUrl: group.joinUrl, note: group.note, status: group.status, qrImagePath: null }));
    if (group.qrImagePath) await seasonPublicAssetsStorage.remove(group.qrImagePath);
    revalidateSeasonInfo(group.seasonId, await seasonSlug(group.seasonId));
    return ok(undefined);
  } catch (error) { return actionError("removeCommunityGroupQr", error); }
}

export async function createSeasonContact(input: { seasonId: string; label: string; publicName?: string; value: string; href?: string; note?: string }): Promise<ActionResult<{ id: string }>> {
  const parsed = contactFields.safeParse(input);
  if (!parsed.success) return failValidation("联系方式无效。 ");
  try {
    const admin = await requireAdmin();
    const row = await db.transaction((tx) => createSeasonContactInTx(tx, context(admin), parsed.data));
    revalidateSeasonInfo(row.seasonId, await seasonSlug(row.seasonId));
    return ok({ id: row.id });
  } catch (error) { return actionError("createSeasonContact", error); }
}

export async function updateSeasonContact(input: { id: string; label: string; publicName?: string; value: string; href?: string; note?: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ id: uuid, label: z.string().trim().min(1).max(100), publicName: nullableText(100), value: z.string().trim().min(1).max(500), href: nullableHref("链接必须是站内路径、HTTP(S) 或 mailto 地址。 ", { allowMailto: true }), note: nullableText(500) }).safeParse(input);
  if (!parsed.success) return failValidation("联系方式无效。 ");
  try {
    const admin = await requireAdmin();
    const [existing] = await db.select().from(seasonContacts).where(eq(seasonContacts.id, parsed.data.id)).limit(1);
    if (!existing) return fail({ code: "NOT_FOUND", message: "联系方式不存在。" });
    const updated = await db.transaction((tx) => updateSeasonContactInTx(tx, context(admin), parsed.data.id, { label: parsed.data.label, publicName: parsed.data.publicName, value: parsed.data.value, href: parsed.data.href, note: parsed.data.note }));
    revalidateSeasonInfo(updated.seasonId, await seasonSlug(updated.seasonId));
    return ok(undefined);
  } catch (error) { return actionError("updateSeasonContact", error); }
}

export async function deleteSeasonContact(id: string): Promise<ActionResult<void>> {
  if (!uuid.safeParse(id).success) return failValidation("联系方式标识无效。 ");
  try {
    const admin = await requireAdmin();
    const row = await db.transaction((tx) => deleteSeasonContactInTx(tx, context(admin), id));
    revalidateSeasonInfo(row.seasonId, await seasonSlug(row.seasonId));
    return ok(undefined);
  } catch (error) { return actionError("deleteSeasonContact", error); }
}

export async function moveSeasonContact(id: string, direction: "up" | "down"): Promise<ActionResult<void>> {
  if (!uuid.safeParse(id).success || !["up", "down"].includes(direction)) return failValidation("排序操作无效。 ");
  try {
    const admin = await requireAdmin();
    const row = await db.transaction((tx) => moveSeasonContactInTx(tx, context(admin), id, direction));
    revalidateSeasonInfo(row.seasonId, await seasonSlug(row.seasonId));
    return ok(undefined);
  } catch (error) { return actionError("moveSeasonContact", error); }
}
