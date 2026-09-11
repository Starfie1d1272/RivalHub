"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { actionError, failValidation } from "@/lib/action-utils";
import { auditActorId, requireAdmin } from "@/lib/auth/session";
import { createAnnouncementInTx, setAnnouncementStatusInTx, updateAnnouncementInTx } from "@/lib/announcements/commands";
import { ok, type ActionResult } from "@/types/action";

const uuid = z.guid();
function parseAnnouncementDateTime(value: string): Date | null {
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}:00Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

const attentionUntilSchema = z.string().trim().refine((value) => parseAnnouncementDateTime(value) !== null, "提醒截止时间无效。 ");
const inputSchema = z.object({
  scope: z.enum(["site", "season"]),
  seasonId: uuid.nullable(),
  type: z.enum(["notice", "product_update", "important_alert"]),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(20_000),
  requiresAttention: z.boolean(),
  attentionUntil: attentionUntilSchema.nullable(),
}).superRefine((value, ctx) => {
  if ((value.scope === "site") !== (value.seasonId === null)) {
    ctx.addIssue({ code: "custom", path: ["seasonId"], message: "公告范围与赛事必须匹配。" });
  }
  if (!value.requiresAttention && value.attentionUntil !== null) {
    ctx.addIssue({ code: "custom", path: ["attentionUntil"], message: "只有需要主动提醒的公告可以设置截止时间。" });
  }
});

type AnnouncementActionInput = z.input<typeof inputSchema>;

function parseInput(input: AnnouncementActionInput):
  | { data: { scope: "site" | "season"; seasonId: string | null; type: "notice" | "product_update" | "important_alert"; title: string; body: string; requiresAttention: boolean; attentionUntil: Date | null } }
  | { error: ActionResult<never> } {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: failValidation("公告内容或范围无效。") };
  return { data: { ...parsed.data, attentionUntil: parsed.data.attentionUntil ? parseAnnouncementDateTime(parsed.data.attentionUntil) : null } };
}

function revalidateAnnouncementPaths(seasonId: string | null): void {
  revalidatePath("/announcements");
  revalidatePath("/admin/operations/announcements");
  if (seasonId) {
    revalidatePath(`/admin/operations/season-info`);
  }
}

export async function createAnnouncement(input: AnnouncementActionInput): Promise<ActionResult<{ id: string }>> {
  const parsed = parseInput(input);
  if ("error" in parsed) return parsed.error;
  try {
    const admin = await requireAdmin();
    const row = await db.transaction((tx) => createAnnouncementInTx(tx, {
      role: admin.role === "super_admin" ? "super_admin" : "season_admin",
      seasonIds: admin.seasonIds,
      actorId: auditActorId(admin),
    }, parsed.data));
    revalidateAnnouncementPaths(row.seasonId);
    return ok({ id: row.id });
  } catch (error) {
    return actionError("createAnnouncement", error);
  }
}

export async function updateAnnouncement(id: string, input: AnnouncementActionInput): Promise<ActionResult<{ id: string }>> {
  const parsedId = uuid.safeParse(id);
  const parsed = parseInput(input);
  if (!parsedId.success || "error" in parsed) return "error" in parsed ? parsed.error : failValidation("公告标识无效。 ");
  try {
    const admin = await requireAdmin();
    const row = await db.transaction((tx) => updateAnnouncementInTx(tx, {
      role: admin.role === "super_admin" ? "super_admin" : "season_admin",
      seasonIds: admin.seasonIds,
      actorId: auditActorId(admin),
    }, parsedId.data, parsed.data));
    revalidateAnnouncementPaths(row.seasonId);
    return ok({ id: row.id });
  } catch (error) {
    return actionError("updateAnnouncement", error);
  }
}

export async function setAnnouncementStatus(id: string, status: "draft" | "published"): Promise<ActionResult<{ status: "draft" | "published" }>> {
  if (!uuid.safeParse(id).success || !["draft", "published"].includes(status)) return failValidation("公告状态无效。 ");
  try {
    const admin = await requireAdmin();
    const row = await db.transaction((tx) => setAnnouncementStatusInTx(tx, {
      role: admin.role === "super_admin" ? "super_admin" : "season_admin",
      seasonIds: admin.seasonIds,
      actorId: auditActorId(admin),
    }, id, status));
    revalidateAnnouncementPaths(row.seasonId);
    return ok({ status: row.status });
  } catch (error) {
    return actionError("setAnnouncementStatus", error);
  }
}
