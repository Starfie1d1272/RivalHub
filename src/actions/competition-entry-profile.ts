"use server";

import { randomUUID } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { competitionEntries, seasons } from "@/db/schema";
import { requireSeasonAdmin, auditActorId } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/auth/supabase-server";
import { writeAuditInTx } from "@/lib/audit/write";
import { actionError, failValidation } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { publicAssetReference, parseOwnedPublicAssetUrl, parsePublicAssetReference } from "@/lib/assets-reference";
import { teamNameSchema } from "@/lib/config/team-config";
import { TEAM_LOGO_BUCKET, TEAM_LOGO_EXTENSIONS } from "@/lib/config/team-logo";
import { LOGO_ALLOWED_TYPES, LOGO_MAX_BYTES } from "@/lib/config/upload-limits";
import { decodeSeasonRules } from "@/lib/seasons/rules";
import { revalidateSeasonPaths } from "@/lib/revalidation";
import { ok, type ActionResult } from "@/types/action";

const ids = z.object({ seasonId: z.guid(), entryId: z.guid() });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function editable(tx: Tx, seasonId: string, entryId: string) {
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, seasonId)).for("update");
  const [entry] = await tx.select().from(competitionEntries).where(and(eq(competitionEntries.id, entryId), eq(competitionEntries.competitionId, seasonId))).for("update");
  if (!season || season.registrationMode !== "solo" || !["registration", "voting", "drafting"].includes(season.status) || !entry || entry.source !== "event_native" || entry.approvedRosterRevisionId || !["draft", "changes_requested"].includes(entry.registrationStatus)) throw new AppError(ErrorCode.VALIDATION_FAILED, "只有赛前尚未采用名单的本届编队可以修改队伍资料。");
  return { season, entry };
}

export async function updateCompetitionEntryName(input: { seasonId: string; entryId: string; name: string }): Promise<ActionResult<void>> {
  const parsed = ids.extend({ name: teamNameSchema }).safeParse(input);
  if (!parsed.success) return failValidation("队伍名称需为 2–32 个字符。");
  const { seasonId, entryId, name } = parsed.data;
  try {
    const admin = await requireSeasonAdmin(seasonId);
    const slug = await db.transaction(async tx => {
      const { season, entry } = await editable(tx, seasonId, entryId);
      if (decodeSeasonRules(season).roster.requireUniqueTeamName) {
        const [conflict] = await tx.select({ id: competitionEntries.id }).from(competitionEntries).where(and(eq(competitionEntries.competitionId, seasonId), ne(competitionEntries.id, entryId), sql`${competitionEntries.registrationStatus} NOT IN ('rejected', 'withdrawn')`, sql`lower(trim(${competitionEntries.name})) = lower(${name})`)).limit(1);
        if (conflict) throw new AppError(ErrorCode.VALIDATION_FAILED, "本届赛事已有同名参赛队。");
      }
      await tx.update(competitionEntries).set({ name, updatedAt: new Date() }).where(eq(competitionEntries.id, entryId));
      await writeAuditInTx(tx, { seasonId, action: "competition_entry.profile.update", actorId: auditActorId(admin), targetId: entryId, meta: { oldName: entry.name, name } });
      return season.slug;
    });
    revalidateSeasonPaths(slug, ["adminDraft", "teams", "draft"]);
    return ok(undefined);
  } catch (error) { return actionError("updateCompetitionEntryName", error); }
}

export async function uploadCompetitionEntryLogo(seasonId: string, entryId: string, formData: FormData): Promise<ActionResult<{ logoUrl: string }>> {
  const file = formData.get("file");
  if (!ids.safeParse({ seasonId, entryId }).success || !(file instanceof File) || !file.size) return failValidation("请选择非空图片。");
  if (!(LOGO_ALLOWED_TYPES as readonly string[]).includes(file.type) || file.size > LOGO_MAX_BYTES) return failValidation("请上传不超过 1 MB 的 JPG、PNG 或 WebP 图片。");
  try {
    const admin = await requireSeasonAdmin(seasonId);
    await db.transaction(tx => editable(tx, seasonId, entryId));
    const bucket = createServiceClient().storage.from(TEAM_LOGO_BUCKET);
    const path = `entries/${entryId}/${randomUUID()}.${TEAM_LOGO_EXTENSIONS[file.type]}`;
    let result;
    try {
      const { error } = await bucket.upload(path, file, { contentType: file.type });
      if (error) throw new AppError(ErrorCode.INTERNAL_ERROR, "图片上传失败，请重试。");
      result = await db.transaction(async tx => {
        const { season, entry } = await editable(tx, seasonId, entryId);
        await tx.update(competitionEntries).set({ logoUrl: publicAssetReference(TEAM_LOGO_BUCKET, path), updatedAt: new Date() }).where(eq(competitionEntries.id, entryId));
        await writeAuditInTx(tx, { seasonId, action: "competition_entry.profile.update", actorId: auditActorId(admin), targetId: entryId, meta: { field: "logo" } });
        return { slug: season.slug, old: entry.logoUrl };
      });
    } catch (error) { await bucket.remove([path]).catch(() => undefined); throw error; }
    const old = result.old && (parsePublicAssetReference(result.old) ?? parseOwnedPublicAssetUrl(result.old));
    if (old && old.bucket === TEAM_LOGO_BUCKET && old.path.startsWith(`entries/${entryId}/`)) await bucket.remove([old.path]).catch(() => undefined);
    revalidateSeasonPaths(result.slug, ["adminDraft", "teams", "draft"]);
    return ok({ logoUrl: bucket.getPublicUrl(path).data.publicUrl });
  } catch (error) { return actionError("uploadCompetitionEntryLogo", error); }
}
