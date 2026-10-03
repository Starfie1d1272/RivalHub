import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ErrorCode } from "@/lib/errors";
const { guard, revoke, audit, update, transaction } = vi.hoisted(() => ({ guard: vi.fn(), revoke: vi.fn(), audit: vi.fn(), update: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSuperAdmin: guard }));
vi.mock("@/lib/auth/session-registry", () => ({ revokeAllApplicationSessionsInTx: revoke }));
vi.mock("@/lib/audit/write", () => ({ writeAuditInTx: audit }));
vi.mock("@/db/client", () => ({ db: { transaction } }));
import { revokeUserSessions } from "@/actions/session-management";
const userId = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({ userId: "admin" });
  update.mockReturnValue({ set: () => ({ where: async () => {} }) });
  transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ update }));
});
describe("administrator application-session boundary", () => {
  it("requires current super-admin authority", async () => {
    guard.mockRejectedValueOnce(new AppError(ErrorCode.FORBIDDEN, "forbidden"));
    expect((await revokeUserSessions({ userId })).success).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });
  it("revokes with audit but never implicitly releases a password block", async () => {
    expect((await revokeUserSessions({ userId })).success).toBe(true);
    expect(revoke).toHaveBeenCalledWith(expect.anything(), userId);
    expect(update).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "user.sessions_revoke", actorId: "admin" }));
  });
  it("allows an explicit reconciled-provider assertion and records it", async () => {
    expect((await revokeUserSessions({ userId, providerMutationSettled: true })).success).toBe(true);
    expect(update).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ meta: { providerMutationSettled: true } }));
  });
});
