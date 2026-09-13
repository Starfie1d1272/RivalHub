import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { dakPairingIntents, dakPairings, type DakPairing } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { writeAuditInTx } from "@/lib/audit/write";
import { DAK_SCOPES, type DakScope } from "./contracts";
import type { CurrentUserAuthorization } from "@/lib/auth/session";

const PAIRING_TTL_MS = 10 * 60 * 1000;

export interface DakPairingStart {
  pairingId: string;
  pollToken: string;
  authorizeUrl: string;
  expiresAt: string;
}

export type DakPairingPoll =
  | { status: "pending"; expiresAt: string }
  | { status: "authorized"; expiresAt: string; accessToken: string }
  | { status: "expired"; expiresAt: string };

export interface DakIntegrationPrincipal {
  pairing: DakPairing;
  userId: string;
}

function hashOpaque(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pairingSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new AppError(ErrorCode.INTERNAL_ERROR, "DAK 连接服务未配置安全凭据。");
  return secret;
}

function accessTokenFor(intentId: string, pollTokenHash: string): string {
  // pollToken is returned only to the waiting Studio process. The browser URL
  // contains pairingId alone, so the browser never receives the API credential.
  // HMAC also prevents a database reader from reconstructing the credential
  // from the stored poll-token hash.
  const proof = createHmac("sha256", pairingSecret()).update(`${intentId}:${pollTokenHash}`).digest("hex");
  return `rh_dak_${intentId}_${proof}`;
}

function normalizeOrigin(origin: string): string {
  const parsed = new URL(origin);
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname || parsed.username || parsed.password) throw new Error("Invalid RivalHub origin");
  return parsed.origin;
}

export async function startDakPairing(origin: string): Promise<DakPairingStart> {
  const safeOrigin = normalizeOrigin(origin);
  const pollToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  const [intent] = await db.insert(dakPairingIntents).values({
    pollTokenHash: hashOpaque(pollToken),
    expiresAt,
  }).returning({ id: dakPairingIntents.id });
  if (!intent) throw new AppError(ErrorCode.INTERNAL_ERROR, "无法创建 DAK 连接请求。");

  const authorizeUrl = new URL("/integrations/dak/connect", safeOrigin);
  authorizeUrl.searchParams.set("pairingId", intent.id);
  return { pairingId: intent.id, pollToken, authorizeUrl: authorizeUrl.toString(), expiresAt: expiresAt.toISOString() };
}

export async function authorizeDakPairing(
  pairingId: string,
  authorization: CurrentUserAuthorization,
): Promise<void> {
  const seasonIds = authorization.role === "super_admin" ? ["*"] : [...authorization.seasonIds].sort();
  if (seasonIds.length === 0) throw new AppError(ErrorCode.FORBIDDEN, "当前账号没有可连接的赛事管理员权限。");

  await db.transaction(async (tx) => {
    const [intent] = await tx.select().from(dakPairingIntents).where(eq(dakPairingIntents.id, pairingId)).for("update");
    if (!intent || intent.expiresAt.getTime() <= Date.now()) {
      if (intent?.status === "pending") await tx.update(dakPairingIntents).set({ status: "expired" }).where(eq(dakPairingIntents.id, intent.id));
      throw new AppError(ErrorCode.VALIDATION_FAILED, "连接请求已过期，请在 DAK Studio 重新发起。");
    }
    if (intent.status !== "pending") throw new AppError(ErrorCode.VALIDATION_FAILED, "连接请求已经处理过。");

    // The raw poll token is not persisted. The Studio derives the same access
    // token from its private poll token after this intent becomes authorized.
    // The hash is filled by the poll endpoint once it presents that token.
    // To keep the DB artifact one-way, the pairing token hash is intentionally
    // derived from the poll hash and intent id below.
    const tokenHash = hashOpaque(accessTokenFor(intent.id, intent.pollTokenHash));
    const [pairing] = await tx.insert(dakPairings).values({
      pairingIntentId: intent.id,
      userId: authorization.userId,
      tokenHash,
      scopes: [...DAK_SCOPES],
      seasonIds,
    }).returning({ id: dakPairings.id });
    if (!pairing) throw new AppError(ErrorCode.INTERNAL_ERROR, "无法保存 DAK 连接。");

    const now = new Date();
    await tx.update(dakPairingIntents).set({
      status: "authorized",
      authorizedByUserId: authorization.userId,
      authorizedAt: now,
    }).where(eq(dakPairingIntents.id, intent.id));
    await writeAuditInTx(tx, {
      action: "admin.dak.pair",
      actorId: authorization.userId,
      targetId: pairing.id,
      meta: { scopeCount: DAK_SCOPES.length, seasonCount: seasonIds.length },
    });
  });
}

export async function pollDakPairing(pairingId: string, pollToken: string): Promise<DakPairingPoll> {
  const tokenHash = hashOpaque(pollToken);
  const [intent] = await db.select().from(dakPairingIntents).where(and(eq(dakPairingIntents.id, pairingId), eq(dakPairingIntents.pollTokenHash, tokenHash)));
  if (!intent) throw new AppError(ErrorCode.UNAUTHORIZED, "连接请求无效。");

  if (intent.status === "pending" && intent.expiresAt.getTime() <= Date.now()) {
    await db.update(dakPairingIntents).set({ status: "expired" }).where(and(eq(dakPairingIntents.id, pairingId), eq(dakPairingIntents.status, "pending")));
    return { status: "expired", expiresAt: intent.expiresAt.toISOString() };
  }
  if (intent.status === "pending") return { status: "pending", expiresAt: intent.expiresAt.toISOString() };
  if (intent.status === "expired") return { status: "expired", expiresAt: intent.expiresAt.toISOString() };

  const [pairing] = await db.select().from(dakPairings).where(eq(dakPairings.pairingIntentId, intent.id));
  if (!pairing || pairing.status !== "active") throw new AppError(ErrorCode.FORBIDDEN, "DAK 连接已撤销。");

  const delivered = await db.transaction(async (tx) => {
    const [locked] = await tx.select({ deliveredAt: dakPairingIntents.deliveredAt })
      .from(dakPairingIntents).where(eq(dakPairingIntents.id, intent.id)).for("update");
    if (!locked || locked.deliveredAt) return false;
    await tx.update(dakPairingIntents).set({ deliveredAt: new Date() }).where(and(eq(dakPairingIntents.id, intent.id), isNull(dakPairingIntents.deliveredAt)));
    return true;
  });
  if (!delivered) return { status: "authorized", expiresAt: intent.expiresAt.toISOString(), accessToken: "" };

  return {
    status: "authorized",
    expiresAt: intent.expiresAt.toISOString(),
    accessToken: accessTokenFor(intent.id, tokenHash),
  };
}

export async function authenticateDakRequest(
  request: Request,
  requiredScope: DakScope,
): Promise<DakIntegrationPrincipal> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? "";
  if (!token || token.length > 4096) throw new AppError(ErrorCode.UNAUTHORIZED, "缺少 DAK 连接凭据。");
  const [pairing] = await db.select().from(dakPairings).where(and(eq(dakPairings.tokenHash, hashOpaque(token)), eq(dakPairings.status, "active")));
  if (!pairing) throw new AppError(ErrorCode.UNAUTHORIZED, "DAK 连接凭据无效或已撤销。");
  if (!pairing.scopes.includes(requiredScope)) throw new AppError(ErrorCode.FORBIDDEN, "DAK 连接没有此操作权限。");
  await db.update(dakPairings).set({ lastUsedAt: new Date() }).where(eq(dakPairings.id, pairing.id));
  return { pairing, userId: pairing.userId };
}

export function pairingCanReadSeason(pairing: Pick<DakPairing, "seasonIds">, seasonId: string): boolean {
  return pairing.seasonIds.includes("*") || pairing.seasonIds.includes(seasonId);
}

export async function revokeDakPairing(pairingId: string, actorId: string): Promise<boolean> {
  const result = await db.transaction(async (tx) => {
    const [pairing] = await tx.select().from(dakPairings).where(eq(dakPairings.id, pairingId)).for("update");
    if (!pairing || pairing.status === "revoked") return false;
    await tx.update(dakPairings).set({ status: "revoked", revokedAt: new Date() }).where(eq(dakPairings.id, pairing.id));
    await writeAuditInTx(tx, { action: "admin.dak.revoke_pairing", actorId, targetId: pairing.id });
    return true;
  });
  return result;
}

/** Test-only helper for contract tests; the production flow never stores raw tokens. */
export function deriveDakAccessTokenForTest(pairingId: string, pollToken: string): string {
  return accessTokenFor(pairingId, hashOpaque(pollToken));
}
