import { describe, expect, it } from "vitest";
import { assertProductionReleaseBuild } from "../../../scripts/release/production-deployment";

describe("production deployment provenance gate", () => {
  it("does not constrain preview builds", () => {
    expect(() => assertProductionReleaseBuild({ VERCEL_ENV: "preview" })).not.toThrow();
  });

  it("accepts a tagged release build with an exact commit sha", () => {
    expect(() => assertProductionReleaseBuild({
      VERCEL_ENV: "production",
      RIVALHUB_RELEASE_TAG: "v2.0.1",
      RIVALHUB_RELEASE_COMMIT: "0123456789abcdef0123456789abcdef01234567",
    })).not.toThrow();
  });

  it("rejects ordinary production Git builds and malformed release markers", () => {
    expect(() => assertProductionReleaseBuild({ VERCEL_ENV: "production" })).toThrow(/tag release workflow/);
    expect(() => assertProductionReleaseBuild({
      VERCEL_ENV: "production",
      RIVALHUB_RELEASE_TAG: "main",
      RIVALHUB_RELEASE_COMMIT: "0123456789abcdef0123456789abcdef01234567",
    })).toThrow(/RIVALHUB_RELEASE_TAG/);
    expect(() => assertProductionReleaseBuild({
      VERCEL_ENV: "production",
      RIVALHUB_RELEASE_TAG: "v2.0.1",
      RIVALHUB_RELEASE_COMMIT: "not-a-sha",
    })).toThrow(/RIVALHUB_RELEASE_COMMIT/);
  });
});
