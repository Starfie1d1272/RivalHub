import { describe, expect, it } from "vitest";
import {
  PRODUCTION_POOLER_HOST,
  PRODUCTION_POOLER_PORT,
  PRODUCTION_PROJECT_REF,
  assertProductionDatabaseUrl,
  buildProductionEnvironment,
  buildVercelProductionVerificationEnvironment,
} from "../../../scripts/db/production-environment";

const runtimeUrl = `postgresql://postgres.${PRODUCTION_PROJECT_REF}:pw@${PRODUCTION_POOLER_HOST}:${PRODUCTION_POOLER_PORT}/postgres`;
const confirmation = {
  RIVALHUB_DB_TARGET: "production",
  RIVALHUB_PRODUCTION_PROJECT_CONFIRM: PRODUCTION_PROJECT_REF,
  RIVALHUB_PRODUCTION_DB_HOST_CONFIRM: `${PRODUCTION_POOLER_HOST}:${PRODUCTION_POOLER_PORT}`,
  DATABASE_URL: runtimeUrl,
};

describe("production database target guard", () => {
  it("reuses only the validated runtime DATABASE_URL", () => {
    const env = buildProductionEnvironment(confirmation, { requiresWriteAuthorization: false });
    expect(env.DATABASE_URL).toContain(`postgres.${PRODUCTION_PROJECT_REF}`);
    expect(env.DATABASE_URL).toContain(`${PRODUCTION_POOLER_HOST}:${PRODUCTION_POOLER_PORT}`);
    expect(env.DATABASE_URL).toContain("pgbouncer=true");
    expect(env.RIVALHUB_PRODUCTION_DATABASE_URL).toBe(env.DATABASE_URL);
    expect(env.RIVALHUB_DB_TARGET).toBe("production");
    expect(env.RIVALHUB_PRODUCTION_DB_PASSWORD).toBeUndefined();
  });

  it("fails closed for missing target confirmation, missing credential, staging targets and unapproved writes", () => {
    expect(() => buildProductionEnvironment({}, { requiresWriteAuthorization: false })).toThrow(/RIVALHUB_DB_TARGET=production/);
    expect(() => buildProductionEnvironment({ ...confirmation, DATABASE_URL: undefined }, { requiresWriteAuthorization: false })).toThrow(/不维护第二份数据库密码/);
    expect(() => buildProductionEnvironment({ ...confirmation, RIVALHUB_DB_TARGET: "staging" }, { requiresWriteAuthorization: false })).toThrow(/RIVALHUB_DB_TARGET=production/);
    expect(() => buildProductionEnvironment({ ...confirmation, RIVALHUB_PRODUCTION_DB_HOST_CONFIRM: `${PRODUCTION_POOLER_HOST}:5432` }, { requiresWriteAuthorization: false })).toThrow(/DB_HOST_CONFIRM/);
    expect(() => buildProductionEnvironment(confirmation, { requiresWriteAuthorization: true })).toThrow(/ALLOW_REMOTE_DB_WRITE=production/);
  });

  it("rejects non-production DATABASE_URL values and only lets Vercel production builds inherit the runtime URL", () => {
    expect(() => buildProductionEnvironment({ ...confirmation, DATABASE_URL: "postgresql://prod.example.com/postgres" }, { requiresWriteAuthorization: false })).toThrow(/固定的 production/);
    expect(() => assertProductionDatabaseUrl(`postgresql://postgres.cueazphyskstwdhnzsxx:pw@${PRODUCTION_POOLER_HOST}:${PRODUCTION_POOLER_PORT}/postgres?pgbouncer=true`)).toThrow(/project ref/);

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
