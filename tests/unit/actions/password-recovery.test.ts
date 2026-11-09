import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, getSession, updateUser, mutate, destroy, select, assertFence } = vi.hoisted(() => ({
  getUser: vi.fn(), getSession: vi.fn(), updateUser: vi.fn(), mutate: vi.fn(),
  destroy: vi.fn(), select: vi.fn(), assertFence: vi.fn(),
}));
vi.mock("@/lib/auth/session-registry", () => ({
  beginAuthentication: vi.fn(async () => "2026-11-09 01:00:00.000123+00"),
  assertAuthenticationFence: assertFence,
}));
vi.mock("@/lib/auth/session", () => ({ destroyUserSession: destroy, getUserSession: getSession }));
vi.mock("@/lib/auth/password-mutation", () => ({ mutatePassword: mutate }));
vi.mock("@/lib/auth/supabase-server", () => ({ createPublicAuthClient: () => ({ auth: { getUser } }), createServiceClient: () => ({ auth: { admin: { updateUserById: updateUser } } }) }));
vi.mock("@/db/client", () => ({ db: { select } }));
import { resetUserPassword, verifyPasswordRecovery, type PasswordRecoveryProof } from "@/actions/password-recovery";
import { createPasswordRecoveryUrl } from "@/lib/auth/password-recovery-intent";

const password = "Recovered-Password7!";
const email = "fixture@example.test";
let proof: PasswordRecoveryProof;

function selection(rows: { userId: string }[]) {
  const where = () => ({ limit: async () => rows });
  return { from: () => ({ where, innerJoin: () => ({ where }) }) };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_SESSION_SECRET", "local-only-recovery-test-seal-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://127.0.0.1:3037");
  proof = { token: new URL(await createPasswordRecoveryUrl(email)).searchParams.get("token")!, accessToken: "provider-token" };
  select.mockReturnValue(selection([{ userId: "canonical" }]));
  getSession.mockResolvedValue({ userId: "canonical", email });
  getUser.mockResolvedValue({ data: { user: { id: "verified-auth", email, email_confirmed_at: "2026-11-08" } }, error: null });
  updateUser.mockResolvedValue({ error: null });
  mutate.mockImplementation(async (_user, _proof, _action, update) => update());
});
afterEach(() => vi.unstubAllEnvs());

describe("server-verified recovery", () => {
  it("requires a current sealed recovery intent before calling Auth", async () => {
    expect((await resetUserPassword({ ...proof, token: "forged" }, password)).success).toBe(false);
    expect(getUser).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });
  it("never updates on an expired provider token", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { status: 403 } });
    expect((await resetUserPassword(proof, password)).success).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("distinguishes a provider outage from an expired link", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { status: 503 } });
    expect(await verifyPasswordRecovery(proof)).toMatchObject({ success: false, error: { code: "INTERNAL_ERROR" } });
    expect(mutate).not.toHaveBeenCalled();
  });
  it("rejects a valid provider subject for another mailbox", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "verified-auth", email: "other@example.test", email_confirmed_at: "2026-11-08" } },
      error: null,
    });
    expect(await verifyPasswordRecovery(proof)).toMatchObject({ success: false, error: { code: "UNAUTHORIZED" } });
    expect(select).not.toHaveBeenCalled();
  });
  it("uses the remotely verified subject and canonical binding, then clears the cookie", async () => {
    expect((await resetUserPassword(proof, password)).success).toBe(true);
    expect(getUser).toHaveBeenCalledWith("provider-token");
    expect(assertFence).toHaveBeenCalledWith(expect.anything(), "canonical", "2026-11-09 01:00:00.000123+00");
    expect(mutate).toHaveBeenCalledWith("canonical", "2026-11-09 01:00:00.000123+00", "user.reset_password", expect.any(Function));
    expect(updateUser).toHaveBeenCalledWith("verified-auth", { password });
    expect(destroy).toHaveBeenCalledOnce();
  });
  it("preserves confirmed recovery when clearing the already-revoked cookie fails", async () => {
    destroy.mockRejectedValueOnce(new Error("cookie cleanup failed"));
    expect(await resetUserPassword(proof, password)).toEqual({ success: true, data: undefined });
  });
  it("does not mutate or clear a session after the active account changes", async () => {
    expect(await verifyPasswordRecovery(proof)).toEqual({ success: true, data: { email } });
    getSession.mockResolvedValue({ userId: "another", email: "other@example.test" });
    expect(await resetUserPassword(proof, password)).toMatchObject({ success: false, error: { code: "FORBIDDEN" } });
    expect(mutate).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });
  it("rejects unbound provider identities and leaves Auth untouched", async () => {
    select.mockReturnValue(selection([]));
    expect((await resetUserPassword(proof, password)).success).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("propagates mutation failure without claiming recovery completion", async () => {
    mutate.mockRejectedValueOnce(new Error("provider unavailable"));
    expect((await resetUserPassword(proof, password)).success).toBe(false);
    expect(destroy).not.toHaveBeenCalled();
  });
});
