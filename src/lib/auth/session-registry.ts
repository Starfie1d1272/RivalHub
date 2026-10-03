import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import type { DB, TxDb } from "@/db/client";
import { applicationSessionControls as controls, applicationSessions as sessions, users } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
/** Captured on the DB clock BEFORE provider verification; never accepted from the browser. */
export async function beginAuthentication(database: Pick<DB, "execute">): Promise<string> {
  const result = await database.execute<{ started_at: string }>(sql`SELECT clock_timestamp()::text AS started_at`);
  return result.rows[0]!.started_at;
}

async function lockUser(tx: TxDb, userId: string) {
  const [user] = await tx.select({ status: users.status }).from(users).where(eq(users.id, userId)).for("update");
  if (user?.status !== "active") throw new AppError(ErrorCode.UNAUTHORIZED, "账号状态已改变，请重新登录。");
  await tx.insert(controls).values({ userId }).onConflictDoNothing();
}

async function assertFreshProof(tx: TxDb, userId: string, startedAt: string) {
  const [control] = await tx.select({
    stale: sql<boolean>`${controls.revokedBefore} >= ${startedAt}::timestamptz`,
    pending: controls.passwordMutationId,
  }).from(controls).where(eq(controls.userId, userId));
  if (!control || control.stale || control.pending) {
    throw new AppError(ErrorCode.UNAUTHORIZED, "账号安全状态已改变，请重新登录或稍后重试。");
  }
}

export async function issueApplicationSessionInTx(tx: TxDb, userId: string, startedAt: string): Promise<string> {
  await lockUser(tx, userId);
  await assertFreshProof(tx, userId, startedAt);
  // Opportunistic per-user cleanup keeps expired sessions out of repeated-login growth.
  await tx.delete(sessions).where(and(eq(sessions.userId, userId), sql`${sessions.expiresAt} <= clock_timestamp()`));
  const [session] = await tx.insert(sessions).values({
    userId,
    expiresAt: sql`clock_timestamp() + ${SESSION_MAX_AGE_SECONDS} * interval '1 second'`,
  }).returning({ id: sessions.id });
  return session!.id;
}

export async function readApplicationSession(database: Pick<DB, "select">, sessionId: string, userId: string) {
  const [row] = await database.select({ userId: users.id, email: users.email })
    .from(sessions).innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), eq(users.status, "active"), gt(sessions.expiresAt, sql`clock_timestamp()`))).limit(1);
  return row ?? null;
}

export async function revokeApplicationSession(database: Pick<DB, "delete">, sessionId: string): Promise<void> {
  await database.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function revokeAllApplicationSessionsInTx(tx: TxDb, userId: string): Promise<void> {
  await lockUser(tx, userId);
  await tx.update(controls).set({ revokedBefore: sql`clock_timestamp()` }).where(eq(controls.userId, userId));
  await tx.delete(sessions).where(eq(sessions.userId, userId));
}

/** Commit BEFORE touching Auth: a crash or ambiguous provider outcome leaves issuance blocked. */
export async function beginPasswordMutationInTx(tx: TxDb, userId: string, startedAt: string): Promise<string> {
  await lockUser(tx, userId);
  await assertFreshProof(tx, userId, startedAt);
  await revokeAllApplicationSessionsInTx(tx, userId);
  const mutationId = randomUUID();
  await tx.update(controls).set({ passwordMutationId: mutationId }).where(eq(controls.userId, userId));
  return mutationId;
}

export async function finishPasswordMutationInTx(tx: TxDb, userId: string, mutationId: string): Promise<void> {
  await lockUser(tx, userId);
  const [control] = await tx.select().from(controls).where(eq(controls.userId, userId));
  if (control?.passwordMutationId !== mutationId) throw new AppError(ErrorCode.UNAUTHORIZED, "密码更新状态已改变。");
  await revokeAllApplicationSessionsInTx(tx, userId);
  await tx.update(controls).set({ passwordMutationId: null }).where(eq(controls.userId, userId));
}
