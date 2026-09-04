import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

import { createBrowserClient } from "@/lib/auth/supabase";
import { createPublicAuthClient, createServiceClient } from "@/lib/auth/supabase-server";

describe("Supabase client boundaries", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    vi.clearAllMocks();
  });

  it("uses the service role only for server clients with persistent auth disabled", () => {
    createServiceClient();
    expect(createClientMock).toHaveBeenCalledWith(
      "https://project.supabase.test",
      "service-role-key",
      expect.objectContaining({ auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: expect.any(Function) } }),
    );
  });

  it("uses the anon key for public auth without persisting browser state", () => {
    createPublicAuthClient();
    expect(createClientMock).toHaveBeenCalledWith(
      "https://project.supabase.test",
      "anon-key",
      expect.objectContaining({ auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: expect.any(Function) } }),
    );
  });

  it("uses the anon key for browser data access", () => {
    createBrowserClient();
    expect(createClientMock).toHaveBeenCalledWith("https://project.supabase.test", "anon-key");
  });
});
