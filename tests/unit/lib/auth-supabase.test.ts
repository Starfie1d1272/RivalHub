import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

import { createBrowserClient } from "@/lib/auth/supabase";
import { createPublicAuthClient, createServiceClient } from "@/lib/auth/supabase-server";

describe("Supabase client boundaries", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.clearAllMocks();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("uses the secret key for server clients with persistent auth disabled", () => {
    createServiceClient();
    expect(createClientMock).toHaveBeenCalledWith(
      "https://project.supabase.test",
      "sb_secret_test",
      expect.objectContaining({ auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: expect.any(Function) } }),
    );
  });

  it("rejects hosted missing modern keys even when old environment variables exist", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(() => createServiceClient()).toThrow(/SUPABASE_SECRET_KEY/);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(() => createBrowserClient()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    expect(() => createPublicAuthClient()).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("uses the publishable key for public auth without persisting browser state", () => {
    createPublicAuthClient();
    expect(createClientMock).toHaveBeenCalledWith(
      "https://project.supabase.test",
      "sb_publishable_test",
      expect.objectContaining({ auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: expect.any(Function) } }),
    );
  });

  it("uses the publishable key for browser data access", () => {
    createBrowserClient();
    expect(createClientMock).toHaveBeenCalledWith("https://project.supabase.test", "sb_publishable_test");
  });
});
