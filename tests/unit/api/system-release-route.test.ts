import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../src/app/api/system/release/route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/system/release", () => {
  it("returns only the immutable release identity with no-store headers", async () => {
    vi.stubEnv("RIVALHUB_RELEASE_TAG", "v2.7.8");
    vi.stubEnv("RIVALHUB_RELEASE_COMMIT", "ABCDEF0123456789ABCDEF0123456789ABCDEF01");

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      releaseTag: "v2.7.8",
      releaseCommit: "abcdef0123456789abcdef0123456789abcdef01",
    });
  });

  it("fails closed without exposing build environment values", async () => {
    vi.stubEnv("RIVALHUB_RELEASE_TAG", undefined);
    vi.stubEnv("RIVALHUB_RELEASE_COMMIT", "not-a-sha");

    const response = GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Production release identity unavailable." });
  });

  it("rejects a malformed production identity instead of serving partial data", async () => {
    vi.stubEnv("RIVALHUB_RELEASE_TAG", "main");
    vi.stubEnv("RIVALHUB_RELEASE_COMMIT", "0123456789abcdef0123456789abcdef01234567");

    const response = GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Production release identity unavailable." });
  });
});
