import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, updateMock, insertMock, transactionMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  updateMock: vi.fn(),
  insertMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { select: selectMock, update: updateMock, insert: insertMock, transaction: transactionMock },
}));
vi.mock("@/lib/audit/write", () => ({ writeAuditInTx: vi.fn() }));

import {
  authorizeMizarPairing,
  deriveMizarCredentialForTest,
  pollMizarPairing,
  startMizarPairing,
} from "@/lib/mizar/installation";
import { deriveDakAccessTokenForTest } from "@/lib/demo-integration/pairing";
import { mizarHttpError, mizarPairingHeaders } from "@/lib/mizar/http";
import { AppError, ErrorCode } from "@/lib/errors";
import { POST as startPost, OPTIONS as startOptions } from "@/app/api/mizar/pairing/start/route";
import { POST as pollPost, OPTIONS as pollOptions } from "@/app/api/mizar/pairing/poll/route";

const pairingId = "10000000-0000-4000-8000-000000000001";
const pollToken = "a".repeat(64);
const competitionId = "30000000-0000-4000-8000-000000000001";
const installationId = "40000000-0000-4000-8000-000000000001";

describe("Mizar pairing unit tests", () => {
  beforeEach(() => {
    process.env.ADMIN_SESSION_SECRET = "local-test-session-secret-that-is-long-enough-32-chars";
    vi.clearAllMocks();
  });

  describe("credential derivation and isolation", () => {
    it("derives a distinct Mizar credential that never matches DAK credential", () => {
      const mizarCredential = deriveMizarCredentialForTest(pairingId, pollToken);
      const dakToken = deriveDakAccessTokenForTest(pairingId, pollToken);

      expect(mizarCredential).toMatch(/^rh_mizar_[0-9a-f-]{36}_[0-9a-f]{64}$/);
      expect(dakToken).toMatch(/^rh_dak_[0-9a-f-]{36}_[0-9a-f]{64}$/);
      expect(mizarCredential).not.toEqual(dakToken);
    });
  });

  describe("startMizarPairing", () => {
    it("creates a pairing intent with valid authorize URL", async () => {
      insertMock.mockReturnValue({
        values: () => ({
          returning: async () => [{ id: pairingId }],
        }),
      });

      const start = await startMizarPairing("https://match.starfie1d.top");
      expect(start.pairingId).toBe(pairingId);
      expect(start.pollToken).toMatch(/^[0-9a-f]{64}$/);
      expect(start.authorizeUrl).toBe("https://match.starfie1d.top/integrations/mizar/connect?pairingId=" + pairingId);
      expect(new Date(start.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("pollMizarPairing", () => {
    it("returns authorized credential and recovers it on retry without re-issuing a new token", async () => {
      const intent = {
        id: pairingId,
        pollTokenHash: createHash("sha256").update(pollToken).digest("hex"),
        status: "authorized" as const,
        expiresAt: new Date(Date.now() + 60_000),
        deliveredAt: null as Date | null,
      };
      const installation = {
        id: installationId,
        competitionId,
        pairingIntentId: pairingId,
        revokedAt: null as Date | null,
        displayName: "赛事管理员",
      };

      selectMock.mockImplementation(() => ({
        from: () => ({
          innerJoin: () => ({
            where: async () => [installation],
          }),
          where: async () => [intent],
        }),
      }));

      updateMock.mockImplementation(() => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            Object.assign(intent, values);
            return [];
          },
        }),
      }));

      const first = await pollMizarPairing(pairingId, pollToken);
      const retry = await pollMizarPairing(pairingId, pollToken);

      expect(first).toEqual(retry);
      expect(first).toMatchObject({
        status: "authorized",
        installationId,
        competitionId,
        credential: deriveMizarCredentialForTest(pairingId, pollToken),
        displayName: "赛事管理员",
      });
      expect(updateMock).toHaveBeenCalledOnce();
    });

    it("rejects polling when installation is revoked", async () => {
      const intent = {
        id: pairingId,
        pollTokenHash: createHash("sha256").update(pollToken).digest("hex"),
        status: "authorized" as const,
        expiresAt: new Date(Date.now() + 60_000),
        deliveredAt: new Date(),
      };
      const installation = {
        id: installationId,
        competitionId,
        pairingIntentId: pairingId,
        revokedAt: new Date(),
      };

      selectMock.mockImplementation(() => ({
        from: () => ({
          innerJoin: () => ({
            where: async () => [installation],
          }),
          where: async () => [intent],
        }),
      }));

      await expect(pollMizarPairing(pairingId, pollToken)).rejects.toThrow("Mizar 连接已撤销");
    });

    it("returns pending when intent is still pending", async () => {
      const intent = {
        id: pairingId,
        pollTokenHash: createHash("sha256").update(pollToken).digest("hex"),
        status: "pending" as const,
        expiresAt: new Date(Date.now() + 60_000),
        deliveredAt: null,
      };

      selectMock.mockImplementation(() => ({
        from: () => ({
          where: async () => [intent],
        }),
      }));

      const result = await pollMizarPairing(pairingId, pollToken);
      expect(result).toMatchObject({ status: "pending" });
    });

    it("marks expired and returns expired when past expiry", async () => {
      const intent = {
        id: pairingId,
        pollTokenHash: createHash("sha256").update(pollToken).digest("hex"),
        status: "pending" as const,
        expiresAt: new Date(Date.now() - 1_000),
        deliveredAt: null,
      };

      selectMock.mockImplementation(() => ({
        from: () => ({
          where: async () => [intent],
        }),
      }));
      updateMock.mockImplementation(() => ({
        set: () => ({
          where: async () => [],
        }),
      }));

      const result = await pollMizarPairing(pairingId, pollToken);
      expect(result).toMatchObject({ status: "expired" });
      expect(updateMock).toHaveBeenCalled();
    });
  });

  describe("authorizeMizarPairing competition scope", () => {
    it("rejects an admin who does not hold the requested competition", async () => {
      await expect(
        authorizeMizarPairing(pairingId, competitionId, { userId: "admin-user", email: "admin@local.test", role: "user", seasonIds: [] }),
      ).rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
      expect(transactionMock).not.toHaveBeenCalled();
    });

    it("binds the installation to one competition and records the authorized user", async () => {
      const txUpdateMock = vi.fn().mockReturnValue({ set: () => ({ where: async () => [] }) });
      transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
        select: () => ({ from: () => ({ where: () => { const rows = [{ id: pairingId, status: "pending", expiresAt: new Date(Date.now() + 60_000), pollTokenHash: "hash" }]; return Object.assign(Promise.resolve(rows), { for: async () => rows }); } }) }),
        insert: () => ({ values: () => ({ returning: async () => [{ id: installationId }] }) }),
        update: txUpdateMock,
      }));

      await authorizeMizarPairing(pairingId, competitionId, { userId: "admin-user", email: "admin@local.test", role: "user", seasonIds: [competitionId] });
      expect(txUpdateMock).toHaveBeenCalled();
    });
  });

  describe("API route handlers", () => {
    it("handles /api/mizar/pairing/start POST and OPTIONS", async () => {
      insertMock.mockReturnValue({
        values: () => ({
          returning: async () => [{ id: pairingId }],
        }),
      });

      const optionsReq = new Request("http://localhost:3000/api/mizar/pairing/start", { method: "OPTIONS" });
      const optionsRes = await startOptions(optionsReq);
      expect(optionsRes.status).toBe(204);

      const postReq = new Request("http://localhost:3000/api/mizar/pairing/start", {
        method: "POST",
        headers: { origin: "http://localhost:5173" },
      });
      const postRes = await startPost(postReq);
      expect(postRes.status).toBe(201);
      expect(postRes.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
      const json = await postRes.json() as { pairingId: string; pollToken: string; authorizeUrl: string };
      expect(json.pairingId).toBe(pairingId);
      expect(json.pollToken).toHaveLength(64);
    });

    it("handles /api/mizar/pairing/poll POST and OPTIONS", async () => {
      const intent = {
        id: pairingId,
        pollTokenHash: createHash("sha256").update(pollToken).digest("hex"),
        status: "authorized" as const,
        expiresAt: new Date(Date.now() + 60_000),
        deliveredAt: null,
      };
      const installation = {
        id: installationId,
        competitionId,
        pairingIntentId: pairingId,
        revokedAt: null,
        displayName: "赛事管理员",
      };
      selectMock.mockImplementation(() => ({
        from: () => ({
          innerJoin: () => ({
            where: async () => [installation],
          }),
          where: async () => [intent],
        }),
      }));
      updateMock.mockImplementation(() => ({
        set: () => ({
          where: async () => [],
        }),
      }));

      const optionsReq = new Request("http://localhost:3000/api/mizar/pairing/poll", { method: "OPTIONS" });
      const optionsRes = await pollOptions(optionsReq);
      expect(optionsRes.status).toBe(204);

      const postReq = new Request("http://localhost:3000/api/mizar/pairing/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin: "http://127.0.0.1:8080" },
        body: JSON.stringify({ pairingId, pollToken }),
      });
      const postRes = await pollPost(postReq);
      expect(postRes.status).toBe(200);
      expect(postRes.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:8080");
      const json = await postRes.json() as { status: string; installationId: string; displayName: string };
      expect(json.status).toBe("authorized");
      expect(json.installationId).toBe(installationId);
      expect(json.displayName).toBe("赛事管理员");
    });

    it("rejects invalid request body on /api/mizar/pairing/poll", async () => {
      const postReq = new Request("http://localhost:3000/api/mizar/pairing/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairingId: "not-a-uuid", pollToken: "short" }),
      });
      const postRes = await pollPost(postReq);
      expect(postRes.status).toBe(400);
    });
  });

  describe("mizarPairingHeaders", () => {
    it("allows localhost, 127.0.0.1, and configured origins", () => {
      process.env.MIZAR_ALLOWED_ORIGINS = "https://mizar.app,tauri://localhost";

      const req1 = new Request("http://localhost:3000/api/mizar/pairing/start", {
        headers: { origin: "http://localhost:5173" },
      });
      const headers1 = mizarPairingHeaders(req1);
      expect(headers1.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
      expect(headers1.get("Cache-Control")).toBe("no-store");

      const req2 = new Request("http://localhost:3000/api/mizar/pairing/start", {
        headers: { origin: "tauri://localhost" },
      });
      expect(mizarPairingHeaders(req2).get("Access-Control-Allow-Origin")).toBe("tauri://localhost");

      const req3 = new Request("http://localhost:3000/api/mizar/pairing/start", {
        headers: { origin: "https://evil.com" },
      });
      expect(mizarPairingHeaders(req3).get("Access-Control-Allow-Origin")).toBeNull();
    });
  });

  describe("mizarHttpError", () => {
    it("maps AppError error codes to appropriate HTTP status codes", () => {
      const resUnauth = mizarHttpError(new AppError(ErrorCode.UNAUTHORIZED, "凭据无效"));
      expect(resUnauth.status).toBe(401);

      const resForbidden = mizarHttpError(new AppError(ErrorCode.FORBIDDEN, "没有权限"));
      expect(resForbidden.status).toBe(403);

      const resValidation = mizarHttpError(new AppError(ErrorCode.VALIDATION_FAILED, "参数错误"));
      expect(resValidation.status).toBe(400);

      const resInternal = mizarHttpError(new AppError(ErrorCode.INTERNAL_ERROR, "敏感内部异常"));
      expect(resInternal.status).toBe(400);
    });
  });
});
