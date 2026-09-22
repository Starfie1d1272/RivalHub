"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { actionError, failValidation } from "@/lib/action-utils";
import { auditActorId, getUserSession, requireSuperAdmin } from "@/lib/auth/session";
import { submitFeedbackInTx, setFeedbackStatusInTx } from "@/lib/feedback/commands";
import { feedbackCategorySchema, normalizeFeedbackBody, safePublicPathname, FEEDBACK_BODY_MAX_LENGTH } from "@/lib/feedback/validation";
import { ok, type ActionResult } from "@/types/action";

const uuid = z.guid();

export async function submitFeedback(input: { category: string; body: string; pathname: string; seasonId?: string | null; honeypot?: string }): Promise<ActionResult<{ accepted: boolean }>> {
  const parsed = z.object({ category: feedbackCategorySchema, body: z.string().max(FEEDBACK_BODY_MAX_LENGTH), pathname: z.unknown(), seasonId: uuid.nullable().optional(), honeypot: z.string().optional() }).safeParse(input);
  if (!parsed.success) return failValidation("反馈类型或内容无效。 ");
  const body = normalizeFeedbackBody(parsed.data.body);
  const pathname = safePublicPathname(parsed.data.pathname);
  if (!pathname || !body || body.length > FEEDBACK_BODY_MAX_LENGTH) return failValidation("请填写有效的反馈内容。 ");
  if (parsed.data.honeypot?.trim()) return ok({ accepted: true });
  try {
    const session = await getUserSession();
    let seasonId: string | null = null;
    const routeSeasonSlug = pathname.split("/").filter(Boolean)[0] ?? null;
    if (parsed.data.seasonId && routeSeasonSlug) {
      const [season] = await db.select({ id: seasons.id, slug: seasons.slug }).from(seasons).where(eq(seasons.id, parsed.data.seasonId)).limit(1);
      if (season?.slug === routeSeasonSlug) seasonId = season.id;
    }
    const result = await db.transaction((tx) => submitFeedbackInTx(tx, {
      actorUserId: session?.userId ?? null,
      seasonId,
      category: parsed.data.category,
      body,
      pathname,
      releaseVersion: process.env.NEXT_PUBLIC_RELEASE_VERSION ?? "2.8.4",
    }));
    return ok({ accepted: result.accepted });
  } catch (error) { return actionError("submitFeedback", error); }
}

export async function setFeedbackStatus(input: { id: string; status: "new" | "triaged" | "resolved" }): Promise<ActionResult<void>> {
  const parsed = z.object({ id: uuid, status: z.enum(["new", "triaged", "resolved"]) }).safeParse(input);
  if (!parsed.success) return failValidation("反馈状态无效。 ");
  try {
    const admin = await requireSuperAdmin();
    await db.transaction((tx) => setFeedbackStatusInTx(tx, { ...parsed.data, actorId: auditActorId(admin) }));
    revalidatePath("/admin/operations/feedback");
    return ok(undefined);
  } catch (error) { return actionError("setFeedbackStatus", error); }
}
