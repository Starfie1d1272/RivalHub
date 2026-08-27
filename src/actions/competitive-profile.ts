"use server";

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditLogs, competitiveRankFacts } from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireAuth } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import { fail, ok, type ActionResult } from "@/types/action";

const factSchema = z.object({ rank: z.string().trim().min(1).max(64), rating: z.coerce.number().finite().min(0).max(999999) });
const schema = z.object({ platform: z.string().trim().min(1).max(64), currentSeasonKey: z.string().trim().min(1).max(128), previousSeasonKey: z.string().trim().min(1).max(128), historicalPeak: factSchema, previousSeasonPeak: factSchema, currentSeasonPeak: factSchema });

export async function saveCompetitiveProfile(input: unknown): Promise<ActionResult<void>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail({ code: ErrorCode.VALIDATION_FAILED, message: "请完整填写历史、上赛季和当前赛季最高段位及 Rating。" });
  try {
    const session = await requireAuth();
    if (parsed.data.currentSeasonKey === parsed.data.previousSeasonKey) throw new AppError(ErrorCode.VALIDATION_FAILED, "当前赛季与上赛季标识不能相同。");
    await db.transaction(async (tx) => {
      const facts = [{ kind: "historical_peak" as const, platformSeasonKey: null, value: parsed.data.historicalPeak }, { kind: "season_peak" as const, platformSeasonKey: parsed.data.previousSeasonKey, value: parsed.data.previousSeasonPeak }, { kind: "season_peak" as const, platformSeasonKey: parsed.data.currentSeasonKey, value: parsed.data.currentSeasonPeak }];
      for (const fact of facts) {
        const identity = fact.platformSeasonKey === null ? isNull(competitiveRankFacts.platformSeasonKey) : eq(competitiveRankFacts.platformSeasonKey, fact.platformSeasonKey);
        const existing = await tx.query.competitiveRankFacts.findFirst({ where: and(eq(competitiveRankFacts.userId, session.userId), eq(competitiveRankFacts.platform, parsed.data.platform), eq(competitiveRankFacts.kind, fact.kind), identity) });
        const values = { rank: fact.value.rank, rating: String(fact.value.rating), updatedAt: new Date() };
        if (existing) await tx.update(competitiveRankFacts).set(values).where(eq(competitiveRankFacts.id, existing.id));
        else await tx.insert(competitiveRankFacts).values({ userId: session.userId, platform: parsed.data.platform, kind: fact.kind, platformSeasonKey: fact.platformSeasonKey, rank: fact.value.rank, rating: String(fact.value.rating) });
      }
      await tx.insert(auditLogs).values({ action: "competitive_profile.self_declare", actorId: auditActorId(session), targetId: session.userId, targetType: "user", meta: { platform: parsed.data.platform, currentSeasonKey: parsed.data.currentSeasonKey, previousSeasonKey: parsed.data.previousSeasonKey } });
    });
    return ok(undefined);
  } catch (error) { return actionError("saveCompetitiveProfile", error); }
}
