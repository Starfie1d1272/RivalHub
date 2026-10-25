import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function config(ci: string | undefined, fixture: string | undefined) {
  vi.stubEnv("CI", ci);
  vi.stubEnv("RIVALHUB_E2E_AUTH_BOOTSTRAP", fixture);
  vi.resetModules();
  return (await import("../../../next.config")).default;
}

describe("CI fixture development indicator", () => {
  it.each(["1", "true"])("disables only the indicator for CI=%s plus the E2E fixture", async ci => {
    const normal = await config(undefined, "1");
    const fixture = await config(ci, "1");
    expect(fixture.devIndicators).toBe(false);
    const { devIndicators, ...rest } = fixture;
    void devIndicators;
    expect(rest).toEqual(normal);
  });

  it.each([
    [undefined, undefined],
    [undefined, "1"],
    ["true", undefined],
    ["true", "0"],
    ["false", "1"],
  ])("preserves the default for CI=%s and fixture=%s", async (ci, fixture) => {
    expect(await config(ci, fixture)).not.toHaveProperty("devIndicators");
  });
});
