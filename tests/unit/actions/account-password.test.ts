import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signIn: vi.fn(), update: vi.fn(), mutate: vi.fn(), destroy: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { query: { users: { findFirst: async () => ({ authId: "fixture-subject" }) } } } }));
vi.mock("@/lib/auth/session-registry", () => ({ beginAuthentication: async () => "proof" }));
vi.mock("@/lib/auth/session", () => ({ requireAuth: async () => ({ userId: "fixture-user", email: "fixture@local.test" }), destroyUserSession: mocks.destroy }));
vi.mock("@/lib/auth/password-mutation", () => ({ mutatePassword: mocks.mutate }));
vi.mock("@/lib/auth/supabase-server", () => ({ createPublicAuthClient: () => ({ auth: { signInWithPassword: mocks.signIn } }), createServiceClient: () => ({ auth: { admin: { updateUserById: mocks.update } } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
import { changeUserPassword } from "@/actions/account";

beforeEach(() => { vi.clearAllMocks(); });

// Existing login tests cannot protect current-password verification: its
// separate action formerly classified every returned SDK error as bad input.
describe("current password verification returned SDK contract", () => {
  it("requires the verified subject to match the canonical account", async () => {
    mocks.signIn.mockResolvedValue({ data: { user: { id: "other-subject" } }, error: null });
    expect(await changeUserPassword("Original-Password8!", "Recovered-Password7!")).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
