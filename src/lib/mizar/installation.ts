import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, type TxDb } from "@/db/client";
import { mizarInstallations, mizarPairings, matchLiveSessions } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAuditInTx } from "@/lib/audit/write";

export const hashCredential = (credential: string) => createHash("sha256").update(credential).digest("hex");

export async function createMizarPairing(competitionId: string, actorId: string) {
  const code = randomBytes(16).toString("base64url");
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  await db.transaction(async tx => {
    await tx.insert(mizarPairings).values({ competitionId, codeHash: hashCredential(code), expiresAt });
    await writeAuditInTx(tx, { seasonId: competitionId, actorId, action: "mizar.pairing.create", targetId: competitionId, meta: { expiresAt: expiresAt.toISOString() } });
  });
  return { code, expiresAt: expiresAt.toISOString() };
}

export async function redeemMizarPairing(code: string, displayName: string) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(code) || !displayName.trim() || displayName.length > 80) throw new AppError(ErrorCode.VALIDATION_FAILED, "请输入有效连接码和设备名称。");
  const credential = randomBytes(32).toString("base64url");
  return db.transaction(async tx => {
    const [pairing] = await tx.select().from(mizarPairings).where(eq(mizarPairings.codeHash, hashCredential(code))).for("update");
    if (!pairing || pairing.consumedAt || pairing.expiresAt <= new Date()) throw new AppError(ErrorCode.FORBIDDEN, "连接码已失效，请重新生成。");
    await tx.update(mizarPairings).set({ consumedAt: new Date() }).where(eq(mizarPairings.id, pairing.id));
    const [installation] = await tx.insert(mizarInstallations).values({ competitionId: pairing.competitionId, displayName: displayName.trim(), credentialHash: hashCredential(credential), lastSeenAt: new Date() }).returning();
    await writeAuditInTx(tx, { seasonId: pairing.competitionId, actorId: "mizar", action: "mizar.installation.paired", targetId: installation.id, meta: { displayName: installation.displayName } });
    return { installationId: installation.id, competitionId: installation.competitionId, credential };
  });
}

export async function authenticateMizar(authorization: string | null) {
  const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) throw new AppError(ErrorCode.FORBIDDEN, "制播设备凭据无效。");
  const [installation] = await db.select().from(mizarInstallations).where(and(eq(mizarInstallations.credentialHash, hashCredential(token)), isNull(mizarInstallations.revokedAt)));
  if (!installation) throw new AppError(ErrorCode.FORBIDDEN, "制播设备连接已撤销。");
  return installation;
}

export async function assertInstallationInTx(tx: TxDb, installationId: string, competitionId: string) {
  const [installation] = await tx.select().from(mizarInstallations).where(and(eq(mizarInstallations.id, installationId), eq(mizarInstallations.competitionId, competitionId), isNull(mizarInstallations.revokedAt))).for("share");
  if (!installation) throw new AppError(ErrorCode.FORBIDDEN, "制播设备连接已撤销。");
  return installation;
}

export async function revokeMizarInstallation(installationId: string, competitionId: string, actorId: string) {
  await db.transaction(async tx => {
    const [installation] = await tx.select().from(mizarInstallations).where(and(eq(mizarInstallations.id, installationId), eq(mizarInstallations.competitionId, competitionId))).for("update");
    if (!installation) throw new AppError(ErrorCode.NOT_FOUND, "制播设备不存在。");
    const now = new Date();
    await tx.update(mizarInstallations).set({ revokedAt: now }).where(eq(mizarInstallations.id, installationId));
    await tx.update(matchLiveSessions).set({ closedAt: now, closeReason: "revoked", autoCanonicalizationArmed: false }).where(and(eq(matchLiveSessions.installationId, installationId), isNull(matchLiveSessions.closedAt)));
    await writeAuditInTx(tx, { seasonId: competitionId, actorId, action: "mizar.installation.revoke", targetId: installationId });
  });
}
