import { describe, expect, it } from "vitest";
import {
  PRODUCTION_POOLER_HOST,
  PRODUCTION_POOLER_PORT,
  PRODUCTION_PROJECT_REF,
  assertProductionDatabaseUrl,
  buildProductionEnvironment,
  buildVercelProductionVerificationEnvironment,
} from "../../../scripts/db/production-environment";

const confirmation = {
  RIVALHUB_DB_TARGET: "production",
  RIVALHUB_PRODUCTION_PROJECT_CONFIRM: PRODUCTION_PROJECT_REF,
  RIVALHUB_PRODUCTION_DB_HOST_CONFIRM: `${PRODUCTION_POOLER_HOST}:${PRODUCTION_POOLER_PORT}`,
  RIVALHUB_PRODUCTION_DB_PASSWORD: "safe password/with?reserved#characters",
};

describe("production database target guard", () => {
  it("constructs only the fixed production pooler URL and strips remote inputs", () => {
    const env = buildProductionEnvironment(confirmation, { requiresWriteAuthorization: false });
    expect(env.DATABASE_URL).toContain(`postgres.${PRODUCTION_PROJECT_REF}`);
    expect(env.DATABASE_URL).toContain(`${PRODUCTION_POOLER_HOST}:${PRODUCTION_POOLER_PORT}`);
    expect(env.DATABASE_URL).toContain("pgbouncer=true");
    expect(env.RIVALHUB_DB_TARGET).toBe("production");
    expect(env.RIVALHUB_PRODUCTION_DB_PASSWORD).toBeUndefined();
  });

  it("fails closed for missing confirmation, staging targets and unapproved writes", () => {
    expect(() => buildProductionEnvironment({}, { requiresWriteAuthorization: false })).toThrow(/RIVALHUB_DB_TARGET=production/);
    expect(() => buildProductionEnvironment({ ...confirmation, RIVALHUB_DB_TARGET: "staging" }, { requiresWriteAuthorization: false })).toThrow(/RIVALHUB_DB_TARGET=production/);
    expect(() => buildProductionEnvironment({ ...confirmation, RIVALHUB_PRODUCTION_DB_HOST_CONFIRM: `${PRODUCTION_POOLER_HOST}:5432` }, { requiresWriteAuthorization: false })).toThrow(/DB_HOST_CONFIRM/);
    expect(() => buildProductionEnvironment(confirmation, { requiresWriteAuthorization: true })).toThrow(/ALLOW_REMOTE_DB_WRITE=production/);
  });

  it("rejects inherited or non-production URLs and only lets Vercel production builds inherit the runtime URL", () => {
    expect(() => buildProductionEnvironment({ ...confirmation, DATABASE_URL: "postgresql://prod.example.com/postgres" }, { requiresWriteAuthorization: false })).toThrow(/不接受 DATABASE_URL/);
    expect(() => assertProductionDatabaseUrl(`postgresql://postgres.cueazphyskstwdhnzsxx:pw@${PRODUCTION_POOLER_HOST}:${PRODUCTION_POOLER_PORT}/postgres?pgbouncer=true`)).toThrow(/project ref/);

    // Vercel's existing runtime URL does not need to carry the operational
    // pgbouncer query marker; the build gate normalizes the known fixed target.
    const runtimeUrl = `postgresql://postgres.${PRODUCTION_PROJECT_REF}:pw@${PRODUCTION_POOLER_HOST}:${PRODUCTION_POOLER_PORT}/postgres`;
    expect(() => buildVercelProductionVerificationEnvironment({ VERCEL_ENV: "preview", DATABASE_URL: runtimeUrl })).toThrow(/VERCEL_ENV=production/);
    const vercelEnv = buildVercelProductionVerificationEnvironment({ VERCEL_ENV: "production", DATABASE_URL: runtimeUrl });
    expect(vercelEnv).toMatchObject({
      RIVALHUB_DB_TARGET: "production",
      RIVALHUB_PRODUCTION_PROJECT_CONFIRM: PRODUCTION_PROJECT_REF,
      RIVALHUB_PRODUCTION_DB_HOST_CONFIRM: `${PRODUCTION_POOLER_HOST}:${PRODUCTION_POOLER_PORT}`,
    });
    expect(vercelEnv.DATABASE_URL).toContain("pgbouncer=true");
  });
});
