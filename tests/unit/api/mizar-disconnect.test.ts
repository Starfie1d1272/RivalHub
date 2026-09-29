import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, updateMock, insertMock, transactionMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  updateMock: vi.fn(),
  insertMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: selectMock,
    update: updateMock,
    insert: insertMock,
    transaction: transactionMock,
  },
}));

const writeAuditInTxMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit/write", () => ({
  writeAuditInTx: writeAuditInTxMock,
}));

import {
  authenticateMizar,
  deriveMizarCredentialForTest,
  hashCredential,
  revokeMizarInstallation,
} from "@/lib/mizar/installation";
import { POST, DELETE } from "@/app/api/mizar/[operation]/route";

const pairingId = "10000000-0000-4000-8000-000000000001";
const pollToken = "b".repeat(64);
const competitionId = "20000000-0000-4000-8000-000000000002";
const installationId = "30000000-0000-4000-8000-000000000003";
const authorizedByUserId = "user-admin-42";

describe("Mizar self-revoke / disconnect endpoint and lifecycle", () => {
  let credential: string;
  let credHash: string;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_SESSION_SECRET = "local-test-session-secret-that-is-long-enough-32-chars";
    credential = deriveMizarCredentialForTest(pairingId, pollToken);
    credHash = hashCredential(credential);
  });

  describe("authenticateMizar", () => {
    it("authenticates active installation when revokedAt is null", async () => {
      const row = {
        id: installationId,
        competitionId,
        authorizedByUserId,
        credentialHash: credHash,
        revokedAt: null,
      };
      selectMock.mockReturnValue({
        from: () => ({
          where: async () => [row],
        }),
      });

      const result = await authenticateMizar(`Bearer ${credential}`);
      expect(result.id).toBe(installationId);
      expect(result.competitionId).toBe(competitionId);
    });

    it("rejects revoked installation by default", async () => {
      const row = {
        id: installationId,
        competitionId,
        authorizedByUserId,
        credentialHash: credHash,
        revokedAt: new Date(),
      };
      selectMock.mockReturnValue({
        from: () => ({
          where: async () => [row],
        }),
      });

      await expect(authenticateMizar(`Bearer ${credential}`)).rejects.toThrow("制播设备连接已撤销。");
    });

    it("allows revoked installation when allowRevoked is true", async () => {
      const row = {
        id: installationId,
        competitionId,
        authorizedByUserId,
        credentialHash: credHash,
        revokedAt: new Date(),
      };
      selectMock.mockReturnValue({
        from: () => ({
          where: async () => [row],
        }),
      });

      const result = await authenticateMizar(`Bearer ${credential}`, { allowRevoked: true });
      expect(result.id).toBe(installationId);
      expect(result.revokedAt).not.toBeNull();
    });

    it("rejects unknown credential even with allowRevoked: true", async () => {
      selectMock.mockReturnValue({
        from: () => ({
          where: async () => [],
        }),
      });

      await expect(authenticateMizar(`Bearer ${credential}`, { allowRevoked: true })).rejects.toThrow("制播设备凭据无效。");
    });
  });

  describe("revokeMizarInstallation idempotency and audit", () => {
    it("revokes active installation, closes active live sessions, and writes audit fact", async () => {
      const row = {
        id: installationId,
        competitionId,
        authorizedByUserId,
        revokedAt: null as Date | null,
      };

      const txSelectMock = vi.fn().mockReturnValue({
        from: () => ({
          where: () => ({
            for: async () => [row],
          }),
        }),
      });
      const txUpdateMock = vi.fn().mockReturnValue({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            Object.assign(row, values);
            return [];
          },
        }),
      });

      transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return await callback({
          select: txSelectMock,
          update: txUpdateMock,
        });
      });

      const outcome = await revokeMizarInstallation(installationId, competitionId, authorizedByUserId);
      expect(outcome).toEqual({ revoked: true, alreadyRevoked: false });
      expect(row.revokedAt).toBeInstanceOf(Date);
      expect(txUpdateMock).toHaveBeenCalledTimes(2); // mizarInstallations + matchLiveSessions
      expect(writeAuditInTxMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "mizar.installation.revoke",
          actorId: authorizedByUserId,
          targetId: installationId,
          seasonId: competitionId,
        }),
      );
    });

    it("is strictly idempotent when installation is already revoked", async () => {
      const past = new Date("2026-09-01T00:00:00Z");
      const row = {
        id: installationId,
        competitionId,
        authorizedByUserId,
        revokedAt: past,
      };

      const txSelectMock = vi.fn().mockReturnValue({
        from: () => ({
          where: () => ({
            for: async () => [row],
          }),
        }),
      });
      const txUpdateMock = vi.fn();

      transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
        return await callback({
          select: txSelectMock,
          update: txUpdateMock,
        });
      });

      const outcome = await revokeMizarInstallation(installationId, competitionId, authorizedByUserId);
      expect(outcome).toEqual({ revoked: true, alreadyRevoked: true });
      expect(row.revokedAt).toBe(past); // unchanged
      expect(txUpdateMock).not.toHaveBeenCalled();
      expect(writeAuditInTxMock).not.toHaveBeenCalled();
    });
  });

  describe("API route POST/DELETE /api/mizar/disconnect", () => {
    it("disconnects via POST /api/mizar/disconnect and returns { revoked: true }", async () => {
      const row = {
        id: installationId,
        competitionId,
        authorizedByUserId,
        credentialHash: credHash,
        revokedAt: null as Date | null,
      };

      selectMock.mockReturnValue({
        from: () => ({
          where: async () => [row],
        }),
      });

      const txSelectMock = vi.fn().mockReturnValue({
        from: () => ({
          where: () => ({
            for: async () => [row],
          }),
        }),
      });
      const txUpdateMock = vi.fn().mockReturnValue({
        set: () => ({
          where: async () => [],
        }),
      });

      transactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
        return await cb({ select: txSelectMock, update: txUpdateMock });
      });

      const req = new Request("http://localhost:3000/api/mizar/disconnect", {
        method: "POST",
        headers: { authorization: `Bearer ${credential}` },
      });

      const res = await POST(req, { params: Promise.resolve({ operation: "disconnect" }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ revoked: true });
    });

    it("returns 200 { revoked: true } idempotently when retrying disconnect after already revoked", async () => {
      const row = {
        id: installationId,
        competitionId,
        authorizedByUserId,
        credentialHash: credHash,
        revokedAt: new Date("2026-09-01T00:00:00Z"),
      };

      selectMock.mockReturnValue({
        from: () => ({
          where: async () => [row],
        }),
      });

      const txSelectMock = vi.fn().mockReturnValue({
        from: () => ({
          where: () => ({
            for: async () => [row],
          }),
        }),
      });
      const txUpdateMock = vi.fn();

      transactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
        return await cb({ select: txSelectMock, update: txUpdateMock });
      });

      const req = new Request("http://localhost:3000/api/mizar/disconnect", {
        method: "POST",
        headers: { authorization: `Bearer ${credential}` },
      });

      const res = await POST(req, { params: Promise.resolve({ operation: "disconnect" }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ revoked: true });
      expect(txUpdateMock).not.toHaveBeenCalled();
      expect(writeAuditInTxMock).not.toHaveBeenCalled();
    });

    it("supports operation 'revoke' and DELETE method", async () => {
      const row = {
        id: installationId,
        competitionId,
        authorizedByUserId,
        credentialHash: credHash,
        revokedAt: null,
      };

      selectMock.mockReturnValue({
        from: () => ({
          where: async () => [row],
        }),
      });

      transactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
        return await cb({
          select: () => ({ from: () => ({ where: () => ({ for: async () => [row] }) }) }),
          update: () => ({ set: () => ({ where: async () => [] }) }),
        });
      });

      const postRevokeReq = new Request("http://localhost:3000/api/mizar/revoke", {
        method: "POST",
        headers: { authorization: `Bearer ${credential}` },
      });
      const postRevokeRes = await POST(postRevokeReq, { params: Promise.resolve({ operation: "revoke" }) });
      expect(postRevokeRes.status).toBe(200);
      expect(await postRevokeRes.json()).toEqual({ revoked: true });

      const deleteReq = new Request("http://localhost:3000/api/mizar/disconnect", {
        method: "DELETE",
        headers: { authorization: `Bearer ${credential}` },
      });
      const deleteRes = await DELETE(deleteReq, { params: Promise.resolve({ operation: "disconnect" }) });
      expect(deleteRes.status).toBe(200);
      expect(await deleteRes.json()).toEqual({ revoked: true });
    });

    it("rejects unauthorized request with 403", async () => {
      const req = new Request("http://localhost:3000/api/mizar/disconnect", {
        method: "POST",
      });
      const res = await POST(req, { params: Promise.resolve({ operation: "disconnect" }) });
      expect(res.status).toBe(403);
    });
  });
});
