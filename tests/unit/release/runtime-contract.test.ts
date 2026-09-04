import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(process.cwd());
const PNPM_SETUP_SHA = "703c52620218391530e48b9e8870d5c0082e1b9b";

function readProjectFile(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

function readPackageManifest(): {
  packageManager?: string;
  engines?: { node?: string };
  devEngines?: { runtime?: { name?: string; version?: string; onFail?: string } };
  scripts?: Record<string, string>;
} {
  return JSON.parse(readProjectFile("package.json")) as {
    packageManager?: string;
    engines?: { node?: string };
    devEngines?: { runtime?: { name?: string; version?: string; onFail?: string } };
    scripts?: Record<string, string>;
  };
}

function readWorkflowJob(workflow: string, jobName: string): string {
  const match = workflow.match(new RegExp(`\\n  ${jobName}:\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:\\n|$)`));
  if (!match) throw new Error(`workflow job not found: ${jobName}`);
  return match[1];
}

function expectPnpmSetup(workflow: string, jobNames: string[]): void {
  expect(workflow).not.toContain("pnpm/action-setup");
  expect(workflow).not.toContain("actions/setup-node");
  expect(workflow).not.toContain("pnpm install --frozen-lockfile");
  expect(workflow.match(/uses: pnpm\/setup@[0-9a-f]{40}/g) ?? []).toHaveLength(jobNames.length);

  for (const jobName of jobNames) {
    const job = readWorkflowJob(workflow, jobName);
    expect(job).toContain(`uses: pnpm/setup@${PNPM_SETUP_SHA} # v2.1.0`);
    expect(job).toContain("cache: true");
    expect(job).toContain("require-lockfile: true");
    expect(job).not.toContain("version: 11.25.0");
    expect(job).not.toContain("node-version:");
  }
}

describe("deployment and operations contracts", () => {
  it("keeps pnpm and Node runtime ownership in the package manifest", () => {
    const manifest = readPackageManifest();

    expect(manifest.packageManager).toBe("pnpm@11.25.0");
    expect(manifest.engines?.node).toBe("24.x");
    expect(manifest.devEngines?.runtime).toEqual({
      name: "node",
      version: "24.x",
      onFail: "download",
    });
    expect(Object.values(manifest.scripts ?? {}).some((script) => script.includes("corepack pnpm"))).toBe(false);
    expect(readProjectFile("scripts/db/local.ts")).not.toContain("corepack");
    expect(readProjectFile("playwright.config.ts")).not.toContain("corepack");
    expect(readProjectFile("pnpm-lock.yaml")).toMatch(
      /node:\n\s+specifier: runtime:24\.x\n\s+version: runtime:24\.\d+\.\d+/,
    );
  });

  it("uses the pinned pnpm/setup owner only in dependency-bearing CI jobs", () => {
    const ci = readProjectFile(".github/workflows/ci.yml");
    const staging = readProjectFile(".github/workflows/staging.yml");
    const release = readProjectFile(".github/workflows/release.yml");

    expectPnpmSetup(ci, ["static", "postgres", "system"]);
    expectPnpmSetup(staging, ["staging"]);
    expectPnpmSetup(release, ["release"]);
    expect(readWorkflowJob(ci, "plan")).not.toContain("pnpm/setup");
    expect(readWorkflowJob(ci, "ci-gate")).not.toContain("pnpm/setup");
    expect(readWorkflowJob(ci, "dependency-review")).not.toContain("pnpm/setup");
  });

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

  it("runs the previous-release compatibility gate in the existing PostgreSQL and release lanes", () => {
    const ci = readProjectFile(".github/workflows/ci.yml");
    const release = readProjectFile(".github/workflows/release.yml");

    expect(ci).toContain("fetch-depth: 0");
    expect(ci).toContain("RIVALHUB_MIGRATION_BASE_SHA:");
    expect(ci).toContain("RIVALHUB_PRODUCTION_STABLE_REF: origin/main");
    expect(ci).toContain("git fetch origin main --tags");
    expect(ci).toContain("- run: pnpm db:check");
    expect(ci).toContain("- run: pnpm db:release-compat");
    expect(ci.indexOf("- run: pnpm db:release-compat")).toBeGreaterThan(ci.indexOf("- run: pnpm db:check"));
    expect(ci.indexOf("- run: pnpm test:integration:pg17")).toBeGreaterThan(ci.indexOf("- run: pnpm db:release-compat"));

    expect(release).toContain("fetch-depth: 0");
    expect(release).toContain("RIVALHUB_PRODUCTION_STABLE_REF: origin/main");
    expect(release).toContain("run: pnpm db:release-compat");
    expect(release.indexOf("run: pnpm db:release-compat")).toBeLessThan(release.indexOf("pnpm db:production:migrate"));
  });

  it("runs each production Cron endpoint independently with bounded retries", () => {
    const workflow = readProjectFile(".github/workflows/cron.yml");
    const paths = [
      "/api/cron/draft-timeout",
      "/api/cron/check-registration-deadline",
      "/api/cron/match-time-auto-award",
      "/api/cron/cleanup-education-evidence",
    ];

    expect(workflow).toContain("fail-fast: false");
    expect(workflow).toContain("timeout-minutes: 5");
    expect(workflow).toContain("matrix:");
    for (const path of paths) expect(workflow).toContain(`path: ${path}`);
    expect((workflow.match(/path: \/api\/cron\//g) ?? [])).toHaveLength(4);
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
