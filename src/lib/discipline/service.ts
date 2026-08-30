import { and, eq, inArray, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  auditLogs,
  disciplinaryCases,
  users,
  type DisciplinaryCase,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

/**
 * H1 — personal disciplinary facts and eligibility blockers.
 *
 * Strict separation of facts:
 *   personal sanction ≠ team eligibility ≠ match result ≠ final placement.
 * Nothing here ever cascades into teams, historical results, placements or
 * honors. A sanction blocks exactly the capabilities it lists, for exactly
 * its subject, during exactly its effective window.
 */

export type SanctionEffect =
  | "registration_block"
  | "roster_block"
  | "match_participation_block";

export const SANCTION_EFFECTS: readonly SanctionEffect[] = [
  "registration_block",
  "roster_block",
  "match_participation_block",
];

export type ResolvedSanctionStatus = "draft" | "active" | "expired" | "revoked";

/**
 * Derived display/effectiveness state. `active` is windowed; an `active`
 * stored row whose window has passed resolves as `expired` (non-blocking)
 * without requiring a mutation first.
 */
export function resolveSanctionStatus(
  row: Pick<DisciplinaryCase, "status" | "effectiveFrom" | "effectiveUntil">,
  now: Date,
): ResolvedSanctionStatus {
  if (row.status === "revoked") return "revoked";
  if (row.status === "draft") return "draft";
  if (row.effectiveFrom.getTime() > now.getTime()) return "draft";
  if (row.effectiveUntil !== null && row.effectiveUntil.getTime() <= now.getTime()) {
    return "expired";
  }
  return "active";
}

/** A sanction blocks a capability only while its resolved status is active. */
export function sanctionBlocks(
  row: Pick<DisciplinaryCase, "status" | "effectiveFrom" | "effectiveUntil" | "effects">,
  effect: SanctionEffect,
  now: Date,
): boolean {
  const effects = (row.effects ?? []) as string[];
  if (!effects.includes(effect)) return false;
  return resolveSanctionStatus(row, now) === "active";
}

/**
 * The only sanctioned public serialization. `internalEvidence` must never be
 * present on this shape — that guarantee is unit-tested.
 */
export function serializeSanctionPublic(
  row: Pick<
    DisciplinaryCase,
    "id" | "seasonId" | "subjectUserId" | "status" | "effects" | "publicExplanation" | "effectiveFrom" | "effectiveUntil" | "createdAt"
  >,
  now: Date,
): {
  id: string;
  seasonId: string;
  subjectUserId: string;
  status: ResolvedSanctionStatus;
  effects: SanctionEffect[];
  explanation: string | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  issuedAt: Date;
} {
  return {
    id: row.id,
    seasonId: row.seasonId,
    subjectUserId: row.subjectUserId,
    status: resolveSanctionStatus(row, now),
    effects: [...((row.effects ?? []) as SanctionEffect[])],
    explanation: row.publicExplanation,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
    issuedAt: row.createdAt,
  };
}

function windowPredicate(effect: SanctionEffect, now: Date) {
  // JSON array containment for the effect list.
  return sql`${disciplinaryCases.effects} @> ${JSON.stringify([effect])}::jsonb
    AND ${disciplinaryCases.effectiveFrom} <= ${now.toISOString()}
    AND (${disciplinaryCases.effectiveUntil} IS NULL OR ${disciplinaryCases.effectiveUntil} >= ${now.toISOString()})`;
}

/** Read-side loader shared by transactions and direct (read-only) callers. */
type SanctionQueryable = Pick<TxDb, "select">;

export interface ActiveSanctionSummary {
  caseId: string;
  userId: string;
  effects: string[];
  until: Date | null;
}

/** Loads the currently-blocking sanctions for the given subjects (scoped). */
export async function loadActiveSanctionsInTx(
  txOrDb: SanctionQueryable,
  args: {
    seasonId: string;
    subjectUserIds?: readonly string[];
    effect?: SanctionEffect;
    now?: Date;
  },
): Promise<Map<string, ActiveSanctionSummary[]>> {
  const now = args.now ?? new Date();
  const conditions = [
    eq(disciplinaryCases.seasonId, args.seasonId),
    eq(disciplinaryCases.status, "active"),
  ];
  if (args.effect) conditions.push(windowPredicate(args.effect, now));
  if (args.subjectUserIds && args.subjectUserIds.length > 0) {
    conditions.push(inArray(disciplinaryCases.subjectUserId, [...args.subjectUserIds]));
  }

  const rows = await txOrDb
    .select({
      id: disciplinaryCases.id,
      subjectUserId: disciplinaryCases.subjectUserId,
      effects: disciplinaryCases.effects,
      effectiveUntil: disciplinaryCases.effectiveUntil,
    })
    .from(disciplinaryCases)
    .where(and(...conditions));

  const byUser = new Map<string, ActiveSanctionSummary[]>();
  for (const row of rows) {
    if (args.effect && !(row.effects as string[]).includes(args.effect)) continue;
    if (
      row.effectiveUntil !== null &&
      row.effectiveUntil.getTime() <= now.getTime()
    ) {
      // Window already passed: inert even without an explicit expire write.
      continue;
    }
    const list = byUser.get(row.subjectUserId) ?? [];
    list.push({
      caseId: row.id,
      userId: row.subjectUserId,
      effects: [...(row.effects as string[])],
      until: row.effectiveUntil,
    });
    byUser.set(row.subjectUserId, list);
  }
  return byUser;
}

export async function assertUsersNotBlockedInTx(
  txOrDb: SanctionQueryable,
  args: {
    seasonId: string;
    userLabels: ReadonlyMap<string, string>;
    effect: SanctionEffect;
    message: string;
  },
): Promise<void> {
  const blocked = await loadActiveSanctionsInTx(txOrDb, {
    seasonId: args.seasonId,
    subjectUserIds: [...args.userLabels.keys()],
    effect: args.effect,
  });
  if (blocked.size === 0) return;

  const offenders = [...blocked.keys()].map((userId) => {
    const label = args.userLabels.get(userId) ?? userId;
    const reasons = blocked.get(userId)!.length;
    void reasons;
    return label;
  });
  throw new AppError(ErrorCode.VALIDATION_FAILED, `${args.message}：${offenders.join("、")}`);
}

// ── Sanction state transitions (idempotent, audited) ───────────────────────

async function lockCaseInTx(
  tx: TxDb,
  caseId: string,
): Promise<DisciplinaryCase> {
  const [locked] = await tx
    .select()
    .from(disciplinaryCases)
    .where(eq(disciplinaryCases.id, caseId))
    .for("update");
  if (!locked) throw new AppError(ErrorCode.NOT_FOUND, "纪律处罚记录不存在。");
  return locked;
}

export async function issueSanctionInTx(
  tx: TxDb,
  args: {
    seasonId: string;
    subjectUserId: string;
    effects: readonly SanctionEffect[];
    internalEvidence?: string | null;
    publicExplanation?: string | null;
    effectiveFrom?: Date;
    effectiveUntil?: Date | null;
    actorId: string;
  },
): Promise<{ caseId: string }> {
  const effects = [...new Set(args.effects)];
  if (effects.length === 0 || !effects.every((effect) => SANCTION_EFFECTS.includes(effect))) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "处罚效果不合法。");
  }
  const [subject] = await tx.select({ id: users.id }).from(users).where(eq(users.id, args.subjectUserId));
  if (!subject) throw new AppError(ErrorCode.NOT_FOUND, "被处罚用户不存在。");

  const effectiveFrom = args.effectiveFrom ?? new Date();
  if (args.effectiveUntil && args.effectiveUntil.getTime() <= effectiveFrom.getTime()) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "生效窗口结束时间必须晚于开始时间。");
  }

  const [created] = await tx
    .insert(disciplinaryCases)
    .values({
      seasonId: args.seasonId,
      subjectUserId: args.subjectUserId,
      status: "active",
      effects,
      internalEvidence: args.internalEvidence ?? null,
      publicExplanation: args.publicExplanation ?? null,
      effectiveFrom,
      effectiveUntil: args.effectiveUntil ?? null,
      issuedBy: args.actorId,
    })
    .returning({ id: disciplinaryCases.id });

  await tx.insert(auditLogs).values({
    seasonId: args.seasonId,
    action: "sanction.issue",
    actorId: args.actorId,
    targetId: created!.id,
    targetType: "disciplinary_case",
    meta: { subjectUserId: args.subjectUserId, effects },
  });
  return { caseId: created!.id };
}

export interface RevokeOutcome {
  alreadyRevoked: boolean;
  caseId: string;
}

export async function revokeSanctionInTx(
  tx: TxDb,
  args: { caseId: string; actorId: string; reason: string },
): Promise<RevokeOutcome> {
  const locked = await lockCaseInTx(tx, args.caseId);
  if (locked.revokedAt !== null || locked.status === "revoked") {
    // Idempotent: repeated revocation requests leave no duplicate audit trail.
    return { alreadyRevoked: true, caseId: locked.id };
  }

  await tx
    .update(disciplinaryCases)
    .set({
      status: "revoked",
      revokedAt: new Date(),
      revokedBy: args.actorId,
      revocationReason: args.reason.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(disciplinaryCases.id, locked.id));

  await tx.insert(auditLogs).values({
    seasonId: locked.seasonId,
    action: "sanction.revoke",
    actorId: args.actorId,
    targetId: locked.id,
    targetType: "disciplinary_case",
    meta: { subjectUserId: locked.subjectUserId, reason: args.reason.trim() || null },
  });
  return { alreadyRevoked: false, caseId: locked.id };
}

export async function markSanctionExpiredInTx(
  tx: TxDb,
  args: { caseId: string; actorId: string },
): Promise<{ alreadyExpired: boolean; caseId: string }> {
  const locked = await lockCaseInTx(tx, args.caseId);
  if (locked.status === "expired") return { alreadyExpired: true, caseId: locked.id };
  if (locked.status !== "active") {
    throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "只有生效中的处罚可以被标记为过期。");
  }
  const resolved = resolveSanctionStatus(locked, new Date());
  if (resolved !== "expired") {
    throw new AppError(ErrorCode.MATCH_INVALID_TRANSITION, "该处罚仍在有效期内，不能标记为过期。");
  }

  await tx
    .update(disciplinaryCases)
    .set({ status: "expired", updatedAt: new Date() })
    .where(eq(disciplinaryCases.id, locked.id));

  await tx.insert(auditLogs).values({
    seasonId: locked.seasonId,
    action: "sanction.expire",
    actorId: args.actorId,
    targetId: locked.id,
    targetType: "disciplinary_case",
    meta: { subjectUserId: locked.subjectUserId },
  });
  return { alreadyExpired: false, caseId: locked.id };
}
