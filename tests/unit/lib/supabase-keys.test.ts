import { describe, expect, it } from "vitest";
import { requireSupabasePublicKey, requireSupabaseSecretKey } from "@/lib/runtime/supabase-keys";
const legacy = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role }))}.signature`;

describe("hosted modern Supabase keys", () => {
  it("requires the canonical modern key and correct privilege", () => {
    expect(requireSupabasePublicKey(" sb_publishable_test ")).toBe("sb_publishable_test");
    expect(requireSupabaseSecretKey(" sb_secret_test ")).toBe("sb_secret_test");
    expect(() => requireSupabasePublicKey()).toThrow(/未设置/);
    expect(() => requireSupabaseSecretKey(" ")).toThrow(/未设置/);
    for (const url of [undefined, "https://project.supabase.co", "http://127.0.0.1.evil.test", "https://localhost.evil.test"]) {
      expect(() => requireSupabasePublicKey(legacy("anon"), url)).toThrow();
      expect(() => requireSupabaseSecretKey(legacy("service_role"), url)).toThrow();
    }
    for (const key of ["sb_secret_private", legacy("service_role"), "eyJbroken"]) {
      expect(() => requireSupabasePublicKey(key)).toThrow();
      try { requireSupabasePublicKey(key); } catch (error) { expect(String(error)).not.toContain(key); }
    }
    expect(() => requireSupabaseSecretKey("sb_publishable_test")).toThrow();
  });
  it("accepts local provider JWT configuration only behind a loopback URL and matching role", () => {
    for (const url of ["http://localhost:54321", "http://127.0.0.1:54321", "http://[::1]:54321"]) {
      expect(requireSupabasePublicKey(legacy("anon"), url)).toBe(legacy("anon"));
      expect(requireSupabaseSecretKey(legacy("service_role"), url)).toBe(legacy("service_role"));
      expect(() => requireSupabasePublicKey(legacy("service_role"), url)).toThrow();
      expect(() => requireSupabaseSecretKey(legacy("anon"), url)).toThrow();
      expect(() => requireSupabasePublicKey("eyJbroken", url)).toThrow();
    }
  });
});
