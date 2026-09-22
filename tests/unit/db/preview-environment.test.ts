import { describe, expect, it } from "vitest";
import { targetEnvironment } from "../../../scripts/db/preview/environment";
import { STAGING_PROJECT_REF } from "../../../scripts/db/staging-environment";

const baseEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "Starfie1d1272/RivalHub",
  GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW: "Refresh Preview Data",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  RIVALHUB_PREVIEW_RESET_CONFIRM: STAGING_PROJECT_REF,
  RIVALHUB_STAGING_PROJECT_CONFIRM: STAGING_PROJECT_REF,
  RIVALHUB_STAGING_DB_HOST_CONFIRM: "aws-0-ap-northeast-1.pooler.supabase.com:6543",
  RIVALHUB_ALLOW_REMOTE_DB_WRITE: "staging",
  RIVALHUB_STAGING_DB_PASSWORD: "safe password",
  RIVALHUB_PREVIEW_DEV_SECRET_KEY: "dev-secret-key",
};

describe("preview refresh target", () => {
  it("accepts the target without a persona secret and returns only real dev credentials", () => {
    const target = targetEnvironment(baseEnvironment);

    expect(target).toMatchObject({
      secretKey: "dev-secret-key",
      supabaseUrl: `https://${STAGING_PROJECT_REF}.supabase.co`,
      applyCurrentMigrations: false,
    });
    expect(target).not.toHaveProperty("personaPassword");
  });

  it("still requires the dev Auth privileged credential", () => {
    expect(() => targetEnvironment({ ...baseEnvironment, RIVALHUB_PREVIEW_DEV_SECRET_KEY: undefined })).toThrow(/Auth credential/);
  });
});
