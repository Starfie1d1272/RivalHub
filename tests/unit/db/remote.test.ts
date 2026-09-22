import { describe, expect, it } from "vitest";
import { shouldUseExternalReleaseMigrationRehearsal } from "../../../scripts/db/remote";

const protectedReleaseEnvironment = {
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_WORKFLOW: "Release",
  RELEASE_TAG: "v2.10.4",
  RELEASE_SHA: "ffd17289d5c57d87f6af6180e834e41c5f318dd5",
  RIVALHUB_ALLOW_REMOTE_DB_WRITE: "production",
  RIVALHUB_DB_TARGET: "production",
  RIVALHUB_RELEASE_MIGRATION_REHEARSAL: "pg17",
  RIVALHUB_RELEASE_SHA: "ffd17289d5c57d87f6af6180e834e41c5f318dd5",
};

describe("remote migration rehearsal ownership", () => {
  it("keeps direct/manual migration on the self-contained local replay path", () => {
    expect(shouldUseExternalReleaseMigrationRehearsal({})).toBe(false);
  });

  it("accepts the explicit marker only in the protected Release context", () => {
    expect(shouldUseExternalReleaseMigrationRehearsal(protectedReleaseEnvironment)).toBe(true);
  });

  it("rejects the marker outside the protected Release context", () => {
    expect(() =>
      shouldUseExternalReleaseMigrationRehearsal({
        RIVALHUB_RELEASE_MIGRATION_REHEARSAL: "pg17",
      }),
    ).toThrow(/protected Release/);
  });

  it("rejects unsupported rehearsal modes", () => {
    expect(() =>
      shouldUseExternalReleaseMigrationRehearsal({
        ...protectedReleaseEnvironment,
        RIVALHUB_RELEASE_MIGRATION_REHEARSAL: "local",
      }),
    ).toThrow(/只支持 pg17/);
  });
});
