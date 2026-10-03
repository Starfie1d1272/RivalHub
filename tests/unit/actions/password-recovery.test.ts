import { beforeEach, describe, expect, it, vi } from "vitest";
const { getUser, updateUser, mutate, destroy, select } = vi.hoisted(() => ({ getUser: vi.fn(), updateUser: vi.fn(), mutate: vi.fn(), destroy: vi.fn(), select: vi.fn() }));
vi.mock("@/lib/auth/session-registry", () => ({ beginAuthentication: vi.fn(async () => "proof") }));
vi.mock("@/lib/auth/session", () => ({ destroyUserSession: destroy }));
vi.mock("@/lib/auth/password-mutation", () => ({ mutatePassword: mutate }));
vi.mock("@/lib/auth/supabase-server", () => ({ createPublicAuthClient: () => ({ auth: { getUser } }), createServiceClient: () => ({ auth: { admin: { updateUserById: updateUser } } }) }));
vi.mock("@/db/client", () => ({ db: { select } }));
import { resetUserPassword } from "@/actions/password-recovery";
const password = "Recovered-Password7!";

beforeEach(() => {
  vi.clearAllMocks();
  select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ userId: "canonical" }] }) }) });
  getUser.mockResolvedValue({ data: { user: { id: "verified-auth" } }, error: null });
  updateUser.mockResolvedValue({ error: null });
  mutate.mockImplementation(async (_user, _proof, _action, update) => update());
});
describe("server-verified recovery", () => {
  it("never updates on a forged/expired provider token", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error("expired") });
    expect((await resetUserPassword("untrusted", password)).success).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("uses the remotely verified subject and canonical binding, then clears the cookie", async () => {
    expect((await resetUserPassword("provider-token", password)).success).toBe(true);
    expect(getUser).toHaveBeenCalledWith("provider-token");
    expect(mutate).toHaveBeenCalledWith("canonical", "proof", "user.reset_password", expect.any(Function));
    expect(updateUser).toHaveBeenCalledWith("verified-auth", { password });
    expect(destroy).toHaveBeenCalledOnce();
  });
  it("rejects unbound provider identities and leaves Auth untouched", async () => {
    select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
    expect((await resetUserPassword("provider-token", password)).success).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("propagates mutation failure without claiming recovery completion", async () => {
    mutate.mockRejectedValueOnce(new Error("provider unavailable"));
    expect((await resetUserPassword("provider-token", password)).success).toBe(false);
    expect(destroy).not.toHaveBeenCalled();
  });
});
