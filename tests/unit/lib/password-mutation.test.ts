import { beforeEach, describe, expect, it, vi } from "vitest";
const { begin, finish, audit, transaction } = vi.hoisted(() => ({ begin: vi.fn(), finish: vi.fn(), audit: vi.fn(), transaction: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { transaction } }));
vi.mock("@/lib/auth/session-registry", () => ({ beginPasswordMutationInTx: begin, finishPasswordMutationInTx: finish }));
vi.mock("@/lib/audit/write", () => ({ writeAuditInTx: audit }));
import { mutatePassword } from "@/lib/auth/password-mutation";

beforeEach(() => {
  vi.clearAllMocks();
  begin.mockResolvedValue("mutation-id");
  transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback("tx"));
});

describe("password provider / registry coordination", () => {
  it("commits the block before calling the provider, then finishes and audits", async () => {
    const update = vi.fn(async () => {
      expect(begin).toHaveBeenCalledOnce();
      expect(finish).not.toHaveBeenCalled();
      return { error: null };
    });
    await mutatePassword("user", "proof", "user.reset_password", update);
    expect(finish).toHaveBeenCalledWith("tx", "user", "mutation-id");
    expect(audit).toHaveBeenCalledWith("tx", expect.objectContaining({ action: "user.reset_password" }));
  });
  it("does not contact Auth when the durable revocation cannot commit", async () => {
    begin.mockRejectedValueOnce(new Error("DB unavailable"));
    const update = vi.fn();
    await expect(mutatePassword("user", "proof", "user.change_password", update)).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });
  it("reports a definite rejection without claiming password success", async () => {
    await expect(mutatePassword("user", "proof", "user.change_password", async () => ({ error: { status: 422 } }))).rejects.toThrow(/密码更新失败/);
    expect(finish).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledWith("tx", expect.objectContaining({ action: "user.password_update_failed" }));
  });
  it.each([undefined, 0, 408, 503])("keeps the durable block on ambiguous HTTP %s", async (status) => {
    await expect(mutatePassword("user", "proof", "user.change_password", async () => ({ error: { status } }))).rejects.toThrow(/无法确认/);
    expect(finish).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith("tx", expect.objectContaining({ action: "user.password_update_started" }));
  });
  it("retains the block on transport exceptions", async () => {
    await expect(mutatePassword("user", "proof", "user.change_password", async () => { throw new Error("timeout"); })).rejects.toThrow();
    expect(finish).not.toHaveBeenCalled();
  });
});
