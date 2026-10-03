import { describe, expect, it } from "vitest";
import { requireSupabasePublicKey, requireSupabaseSecretKey } from "@/lib/runtime/supabase-keys";

const legacy = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role }))}.signature`;

describe("Supabase key selection", () => {
  it("prefers modern keys and retains blank/missing legacy fallback", () => {
    expect(requireSupabasePublicKey(" sb_publishable_local ", legacy("anon"))).toBe("sb_publishable_local");
    expect(requireSupabasePublicKey(" ", legacy("anon"))).toBe(legacy("anon"));
    expect(requireSupabaseSecretKey(" sb_secret_local ", "legacy")).toBe("sb_secret_local");
    expect(requireSupabaseSecretKey(undefined, "legacy")).toBe("legacy");
  });
  it("rejects missing keys and privileged public configuration without disclosing keys", () => {
    expect(() => requireSupabasePublicKey()).toThrow(/未设置/);
    expect(() => requireSupabaseSecretKey(" ", " ")).toThrow(/未设置/);
    for (const key of ["sb_secret_private", legacy("service_role"), "eyJbroken"]) {
      expect(() => requireSupabasePublicKey(key)).toThrow();
      try { requireSupabasePublicKey(key); } catch (error) {
        expect(String(error)).not.toContain(key);
      }
    }
    expect(() => requireSupabaseSecretKey("sb_publishable_local")).toThrow(/特权/);
  });
});
