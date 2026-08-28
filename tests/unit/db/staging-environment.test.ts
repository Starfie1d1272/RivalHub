import { describe, expect, it } from "vitest";
import {
  assertStagingDatabaseUrl,
  buildStagingEnvironment,
  STAGING_PROJECT_REF,
} from "../../../scripts/db/staging-environment";

const baseEnvironment = {
  RIVALHUB_STAGING_PROJECT_CONFIRM: STAGING_PROJECT_REF,
  RIVALHUB_STAGING_DB_PASSWORD: "safe password/with?reserved#characters",
};

describe("staging database target guard", () => {
  it("constructs only the fixed rivalhub-dev Transaction Pooler URL", () => {
    const env = buildStagingEnvironment(baseEnvironment, { requiresWriteAuthorization: false });

    expect(env.DATABASE_URL).toContain(`postgres.${STAGING_PROJECT_REF}`);
    expect(env.DATABASE_URL).toContain("aws-0-ap-northeast-1.pooler.supabase.com:6543");
    expect(env.DATABASE_URL).toContain("pgbouncer=true");
    expect(env.RIVALHUB_DB_TARGET).toBe("staging");
    expect(env.RIVALHUB_STAGING_DB_PASSWORD).toBeUndefined();
  });

  it("requires the exact target acknowledgement, a password, and write opt-in", () => {
    expect(() =>
      buildStagingEnvironment({}, { requiresWriteAuthorization: false }),
    ).toThrow(/RIVALHUB_STAGING_PROJECT_CONFIRM/);
    expect(() =>
      buildStagingEnvironment(
        { ...baseEnvironment, RIVALHUB_STAGING_PROJECT_CONFIRM: "other-project" },
        { requiresWriteAuthorization: false },
      ),
    ).toThrow(/PROJECT_CONFIRM/);
    expect(() =>
      buildStagingEnvironment(
        { RIVALHUB_STAGING_PROJECT_CONFIRM: STAGING_PROJECT_REF },
        { requiresWriteAuthorization: false },
      ),
    ).toThrow(/DB_PASSWORD/);
    expect(() =>
      buildStagingEnvironment(baseEnvironment, { requiresWriteAuthorization: true }),
    ).toThrow(/ALLOW_REMOTE_DB_WRITE=staging/);
  });

  it("rejects inherited DATABASE_URL values and any non-fixed pooler URL", () => {
    expect(() =>
      buildStagingEnvironment(
        { ...baseEnvironment, DATABASE_URL: "postgresql://prod.example.com/postgres" },
        { requiresWriteAuthorization: false },
      ),
    ).toThrow(/不接受 DATABASE_URL/);

    expect(() =>
      assertStagingDatabaseUrl("postgresql://postgres.other:secret@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true"),
    ).toThrow(/固定的 rivalhub-dev/);
  });
});
