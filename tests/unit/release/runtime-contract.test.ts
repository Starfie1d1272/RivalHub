import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(process.cwd());

function readProjectFile(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

describe("deployment and operations contracts", () => {
  it("declares the single Vercel Function region and disables only main Git deployment", () => {
    const config = JSON.parse(readProjectFile("vercel.json")) as {
      buildCommand?: string;
      regions?: string[];
      git?: { deploymentEnabled?: boolean | Record<string, boolean> };
    };

    expect(config.buildCommand).toBe("tsx scripts/vercel-build.ts");
    expect(config.regions).toEqual(["hnd1"]);
    expect(config.git?.deploymentEnabled).toEqual({ main: false });
    expect(config.git?.deploymentEnabled).not.toBe(false);
  });

  it("keeps staging as a protected manual database-only rehearsal", () => {
    const workflow = readProjectFile(".github/workflows/staging.yml");

    expect(workflow).toMatch(/^on:\n  workflow_dispatch:\s*$/m);
    expect(workflow).not.toMatch(/^\s+(push|pull_request|schedule|release):/m);
    expect(workflow).toContain("default: dev");
    expect(workflow).toContain("ref: ${{ inputs.ref }}");
    expect(workflow).toContain("git rev-parse HEAD");
    expect(workflow).toContain("environment: staging");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).not.toMatch(/contents:\s+write/);
    expect(workflow).toContain("RIVALHUB_DB_TARGET: staging");
    expect(workflow).toContain("RIVALHUB_STAGING_PROJECT_CONFIRM: cueazphyskstwdhnzsxx");
    expect(workflow).toContain("RIVALHUB_ALLOW_REMOTE_DB_WRITE: staging");
    expect(workflow).toContain("RIVALHUB_STAGING_DB_PASSWORD: ${{ secrets.RIVALHUB_STAGING_DB_PASSWORD }}");
    expect(workflow).toContain("pnpm db:local:start-db");
    expect(workflow).toContain("pnpm db:staging:migrate");
    expect(workflow).toContain("pnpm db:staging:verify");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("pnpm db:local:stop");
    expect(workflow).not.toMatch(/(?:db:push|db:local:reset|db:local:seed|pnpm seed|db:production|vercel deploy|--prod)/);
    expect(workflow).not.toMatch(/\bproduction\b/i);
  });

  it("runs each production Cron endpoint independently with bounded retries", () => {
    const workflow = readProjectFile(".github/workflows/cron.yml");
    const paths = [
      "/api/cron/draft-timeout",
      "/api/cron/check-registration-deadline",
      "/api/cron/match-time-auto-award",
    ];

    expect(workflow).toContain("fail-fast: false");
    expect(workflow).toContain("timeout-minutes: 5");
    expect(workflow).toContain("matrix:");
    for (const path of paths) expect(workflow).toContain(`path: ${path}`);
    expect((workflow.match(/path: \/api\/cron\//g) ?? [])).toHaveLength(3);
    expect(workflow).toContain("CRON_SECRET: ${{ secrets.CRON_SECRET }}");
    expect(workflow).toContain('Authorization: Bearer ${CRON_SECRET}');
    expect(workflow).toContain("--fail");
    expect(workflow).toContain("--silent");
    expect(workflow).toContain("--show-error");
    expect(workflow).toContain("--connect-timeout 10");
    expect(workflow).toContain("--max-time 60");
    expect(workflow).toContain("--retry 2");
    expect(workflow).toContain("--retry-all-errors");
    expect(workflow).toContain("--retry-delay 5");
    expect(workflow).toContain("--retry-max-time 180");
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).not.toContain("|| true");
  });
});
