import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, type TxDb } from "@/db/client";
import { mizarInstallations, mizarPairingIntents, matchLiveSessions, seasons, users } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAuditInTx } from "@/lib/audit/write";
import { hashOpaque, pairingProof, PAIRING_TTL_MS } from "@/lib/integrations/pairing-security";
import type { CurrentUserAuthorization } from "@/lib/auth/session";

export const hashCredential = hashOpaque;

export interface MizarPairingStart {
  pairingId: string;
  pollToken: string;
  authorizeUrl: string;
  expiresAt: string;
}

export type MizarPairingPoll =
  | { status: "pending"; expiresAt: string }
  | { status: "authorized"; expiresAt: string; installationId: string; competitionId: string; credential: string; displayName: string }
  | { status: "expired"; expiresAt: string };

function installationCredential(intentId: string, pollTokenHash: string): string {
  return `rh_mizar_${intentId}_${pairingProof(intentId, pollTokenHash, "mizar")}`;
}

/** Test-only helper for contract tests; the production flow never stores raw tokens. */
export function deriveMizarCredentialForTest(pairingId: string, pollToken: string): string {
  return installationCredential(pairingId, hashOpaque(pollToken));
}

export async function startMizarPairing(origin: string): Promise<MizarPairingStart> {
  const safeOrigin = new URL(origin);
  if (!["http:", "https:"].includes(safeOrigin.protocol) || !safeOrigin.hostname || safeOrigin.username || safeOrigin.password) throw new AppError(ErrorCode.VALIDATION_FAILED, "RivalHub 授权地址无效。");
  const pollToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  const [intent] = await db.insert(mizarPairingIntents).values({ pollTokenHash: hashOpaque(pollToken), expiresAt }).returning({ id: mizarPairingIntents.id });
  const authorizeUrl = new URL("/integrations/mizar/connect", safeOrigin.origin);
  authorizeUrl.searchParams.set("pairingId", intent.id);
  return { pairingId: intent.id, pollToken, authorizeUrl: authorizeUrl.toString(), expiresAt: expiresAt.toISOString() };
}

export async function authorizeMizarPairing(pairingId: string, competitionId: string, authorization: CurrentUserAuthorization): Promise<void> {
  if (authorization.role !== "super_admin" && !authorization.seasonIds.includes(competitionId)) throw new AppError(ErrorCode.FORBIDDEN, "当前账号没有该赛事的管理员权限。");
  await db.transaction(async tx => {
    const [intent] = await tx.select().from(mizarPairingIntents).where(eq(mizarPairingIntents.id, pairingId)).for("update");
    if (!intent || intent.expiresAt.getTime() <= Date.now()) throw new AppError(ErrorCode.VALIDATION_FAILED, "连接请求已过期，请回到 Mizar 重新发起。");
    if (intent.status !== "pending") throw new AppError(ErrorCode.VALIDATION_FAILED, "连接请求已经处理过。");
    const [season] = await tx.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, competitionId));
    if (!season) throw new AppError(ErrorCode.NOT_FOUND, "赛事不存在。");
    const [installation] = await tx.insert(mizarInstallations).values({
      competitionId,
      pairingIntentId: intent.id,
      authorizedByUserId: authorization.userId,
      credentialHash: hashCredential(installationCredential(intent.id, intent.pollTokenHash)),
    }).returning({ id: mizarInstallations.id });
    const now = new Date();
    await tx.update(mizarPairingIntents).set({ status: "authorized", competitionId, authorizedByUserId: authorization.userId, authorizedAt: now }).where(eq(mizarPairingIntents.id, intent.id));
    await writeAuditInTx(tx, { seasonId: competitionId, actorId: authorization.userId, action: "mizar.installation.paired", targetId: installation.id, meta: { pairingIntentId: intent.id } });
  });
}

export async function pollMizarPairing(pairingId: string, pollToken: string): Promise<MizarPairingPoll> {
  const tokenHash = hashOpaque(pollToken);
  const [intent] = await db.select().from(mizarPairingIntents).where(and(eq(mizarPairingIntents.id, pairingId), eq(mizarPairingIntents.pollTokenHash, tokenHash)));
  if (!intent) throw new AppError(ErrorCode.UNAUTHORIZED, "连接请求无效。");
  const expiresAt = intent.expiresAt.toISOString();
  if (intent.expiresAt.getTime() <= Date.now()) {
    if (intent.status === "pending") await db.update(mizarPairingIntents).set({ status: "expired" }).where(and(eq(mizarPairingIntents.id, pairingId), eq(mizarPairingIntents.status, "pending")));
    return { status: "expired", expiresAt };
  }
  if (intent.status === "pending") return { status: "pending", expiresAt };
  if (intent.status === "expired") return { status: "expired", expiresAt };
  const [installation] = await db
    .select({
      id: mizarInstallations.id,
      competitionId: mizarInstallations.competitionId,
      revokedAt: mizarInstallations.revokedAt,
      displayName: users.displayName,
    })
    .from(mizarInstallations)
    .innerJoin(users, eq(users.id, mizarInstallations.authorizedByUserId))
    .where(eq(mizarInstallations.pairingIntentId, intent.id));
  if (!installation || installation.revokedAt) throw new AppError(ErrorCode.FORBIDDEN, "Mizar 连接已撤销。");
  if (!intent.deliveredAt) await db.update(mizarPairingIntents).set({ deliveredAt: new Date() }).where(and(eq(mizarPairingIntents.id, intent.id), isNull(mizarPairingIntents.deliveredAt)));
  return {
    status: "authorized",
    expiresAt,
    installationId: installation.id,
    competitionId: installation.competitionId,
    credential: installationCredential(intent.id, tokenHash),
    displayName: installation.displayName?.trim() || "赛事管理员",
  };
}

/** Syntax and opaque lookup key only; never authenticates the installation. */
export function readMizarCredentialHash(authorization: string | null): string {
  const token = authorization?.match(/^Bearer\s+(rh_mizar_[0-9a-f-]{36}_[0-9a-f]{64})$/i)?.[1];
  if (!token) throw new AppError(ErrorCode.FORBIDDEN, "制播设备凭据无效。");
  return hashCredential(token);
}

export async function authenticateMizar(authorization: string | null, options: { allowRevoked?: boolean } = {}) {
  const credentialHash = readMizarCredentialHash(authorization);
  const [installation] = await db.select().from(mizarInstallations).where(eq(mizarInstallations.credentialHash, credentialHash));
  if (!installation) throw new AppError(ErrorCode.FORBIDDEN, "制播设备凭据无效。");
  if (!options.allowRevoked && installation.revokedAt !== null) {
    throw new AppError(ErrorCode.FORBIDDEN, "制播设备连接已撤销。");
  }
  return installation;
}

export async function assertInstallationInTx(tx: TxDb, installationId: string, competitionId: string) {
  const [installation] = await tx.select().from(mizarInstallations).where(and(eq(mizarInstallations.id, installationId), eq(mizarInstallations.competitionId, competitionId), isNull(mizarInstallations.revokedAt))).for("share");
  if (!installation) throw new AppError(ErrorCode.FORBIDDEN, "制播设备连接已撤销。");
  return installation;
}

export async function revokeMizarInstallation(installationId: string, competitionId: string, actorId: string, reason = "") {
  return await db.transaction(async tx => {
    const [installation] = await tx.select().from(mizarInstallations).where(and(eq(mizarInstallations.id, installationId), eq(mizarInstallations.competitionId, competitionId))).for("update");
    if (!installation) throw new AppError(ErrorCode.NOT_FOUND, "制播设备不存在。");
    // The authenticated producer disconnect route uses its own installation ID.
    if (installation.authorizedByUserId !== actorId && installation.id !== actorId) {
      const [actor] = await tx.select({ role: users.role }).from(users).where(eq(users.id, actorId));
      if (actor?.role !== "super_admin") throw new AppError(ErrorCode.FORBIDDEN, "请由设备授权人或超级管理员撤销连接。");
      if (!reason.trim() || reason.length > 500) throw new AppError(ErrorCode.VALIDATION_FAILED, "请填写撤销他人设备授权的原因（500 字以内）。");
    }
    if (installation.revokedAt !== null) return { revoked: true, alreadyRevoked: true };
    const now = new Date();
    await tx.update(mizarInstallations).set({ revokedAt: now }).where(eq(mizarInstallations.id, installationId));
    await tx.update(matchLiveSessions).set({ closedAt: now, closeReason: "revoked", autoCanonicalizationArmed: false }).where(and(eq(matchLiveSessions.installationId, installationId), isNull(matchLiveSessions.closedAt)));
    await writeAuditInTx(tx, { seasonId: competitionId, actorId, action: "mizar.installation.revoke", targetId: installationId, meta: { authorizedByUserId: installation.authorizedByUserId, reason: reason.trim() } });
    return { revoked: true, alreadyRevoked: false };
  });
}
