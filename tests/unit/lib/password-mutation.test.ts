import { beforeEach, describe, expect, it, vi } from "vitest";
const { begin, finish, audit, transaction } = vi.hoisted(() => ({ begin: vi.fn(), finish: vi.fn(), audit: vi.fn(), transaction: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { transaction } }));
vi.mock("@/lib/auth/session-registry", () => ({ beginPasswordMutationInTx: begin, finishPasswordMutationInTx: finish }));
vi.mock("@/lib/audit/write", () => ({ writeAuditInTx: audit }));
import { mutatePassword } from "@/lib/auth/password-mutation";
import { PasswordMutationError, passwordFailureCause } from "@/lib/auth/password-error";

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
  it.each([undefined, 0, 408, 503, "422"])("keeps the durable block on ambiguous HTTP %s", async (status) => {
    const cause = { status, code: "unexpected_failure" };
    await expect(mutatePassword("user", "proof", "user.change_password", async () => ({ error: cause }))).rejects.toMatchObject({ code: "PASSWORD_UPDATE_OUTCOME_UNKNOWN", cause });
    expect(finish).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith("tx", expect.objectContaining({ action: "user.password_update_started" }));
  });
  it("retains the block on transport exceptions", async () => {
    const cause = new Error("timeout");
    await expect(mutatePassword("user", "proof", "user.change_password", async () => { throw cause; })).rejects.toMatchObject({ cause });
    expect(finish).not.toHaveBeenCalled();
  });
  // A final DB error must preserve the known provider result and DB cause,
  // rather than generic refresh/retry advice. PG owns actual rollback evidence.
  it.each([null, { status: 422 }])("retains finalization cause after provider result %j", async (error) => {
    const cause = Object.assign(new Error("private-query-body"), { code: "40001" });
    transaction.mockImplementationOnce(async (callback: (tx: unknown) => unknown) => callback("tx"));
    transaction.mockRejectedValueOnce(cause);
    const update = vi.fn(async () => ({ error }));
    await expect(mutatePassword("user", "proof", "user.reset_password", update)).rejects.toMatchObject({
      outcome: "finalization_unknown", providerOutcome: error ? "rejected" : "succeeded", cause,
      code: "PASSWORD_UPDATE_OUTCOME_UNKNOWN",
    });
    expect(update).toHaveBeenCalledOnce();
    expect(passwordFailureCause(cause)).toEqual({ name: "Error", code: "40001" });
  });
  it("projects nested transport causes without provider body or executable getters", () => {
    const cause = Object.assign(new Error("raw credential body"), { code: "ETIMEDOUT" });
    const outer = new PasswordMutationError("unknown", new TypeError("raw token", { cause }));
    expect(passwordFailureCause(outer.cause)).toEqual({ name: "TypeError", cause: { name: "Error", code: "ETIMEDOUT" } });
    const cyclic = { name: "secret-name", code: "secret-code", get message() { throw new Error("never read body"); }, cause: {} };
    cyclic.cause = cyclic;
    expect(JSON.stringify(passwordFailureCause(cyclic))).not.toMatch(/secret|body/);
  });
});
