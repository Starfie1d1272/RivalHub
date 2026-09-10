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

    expect(manifest.packageManager).toBe("pnpm@12.3.4");
    expect(manifest.engines?.node).toBe("24.x");
    expect(manifest.devEngines?.runtime).toEqual({
      name: "node",
      version: "24.x",
      onFail: "download",
    });
    expect(manifest.scripts?.["db:recovery:fetch"]).toBe("tsx scripts/db/recovery/fetch.ts");
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
    const recoveryBackup = readProjectFile(".github/workflows/recovery-backup.yml");
    const recoveryR2 = readProjectFile(".github/workflows/recovery-r2.yml");

    expectPnpmSetup(ci, ["static", "postgres", "system"]);
    expectPnpmSetup(staging, ["staging"]);
    expectPnpmSetup(release, ["release"]);
    expectPnpmSetup(recoveryBackup, ["backup"]);
    expectPnpmSetup(recoveryR2, ["retention"]);
    expect(readWorkflowJob(ci, "plan")).not.toContain("pnpm/setup");
    const gate = readWorkflowJob(ci, "gate");
    expect(gate).toContain("name: ${{ needs.plan.outputs.gate_name }}");
    expect(gate).not.toContain("pnpm/setup");
    expect(readWorkflowJob(ci, "dependency-review")).not.toContain("pnpm/setup");
  });

  it("keeps production recovery snapshots encrypted and outside GitHub artifacts", () => {
    const backup = readProjectFile(".github/workflows/recovery-backup.yml");
    const r2 = readProjectFile(".github/workflows/recovery-r2.yml");
    const release = readProjectFile(".github/workflows/release.yml");
    const nextConfig = readProjectFile("next.config.ts");

    expect(backup).not.toContain('cron: "17 * * * *"');
    expect(backup).toContain('cron: "15 0 * * *"');
    expect(backup).toContain("github.event_name == 'schedule' && 'daily'");
    expect(backup).toContain("environment: production");
    expect(backup).toContain("RIVALHUB_DB_TARGET: production");
    expect(backup).toContain("RIVALHUB_PRODUCTION_BASE_URL: https://match.starfie1d.top");
    expect(backup).not.toContain("RIVALHUB_PRODUCTION_STABLE_REF");
    expect(backup).toContain("SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}");
    expect(backup).toContain("SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}");
    expect(backup).toContain("RIVALHUB_BACKUP_AGE_RECIPIENT: ${{ vars.RIVALHUB_BACKUP_AGE_RECIPIENT }}");
    expect(backup).not.toContain("RIVALHUB_BACKUP_HEARTBEAT_URL");
    expect(backup).toContain("RIVALHUB_R2_ACCESS_KEY_ID: ${{ secrets.RIVALHUB_R2_ACCESS_KEY_ID }}");
    expect(backup).toContain("pnpm db:recovery:backup \"$RIVALHUB_BACKUP_CLASS\"");
    expect(backup).not.toContain("upload-artifact");

    expect(r2).toContain("type: choice");
    expect(r2).toContain("pnpm db:recovery:r2:verify");
    expect(r2).toContain("pnpm db:recovery:r2:apply");
    expect(r2).toContain("environment: production");

    expect(release).toContain("Create protected pre-release backup");
    expect(release).toContain("RIVALHUB_PRODUCTION_BASE_URL: https://match.starfie1d.top");
    expect(release.indexOf("Create protected pre-release backup")).toBeLessThan(release.indexOf("pnpm db:production:migrate"));
    expect(release).toContain("pnpm db:recovery:backup pre-release");
    expect(release).toContain("SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}");
    expect(release).toContain("SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}");
    expect(release).not.toContain("RIVALHUB_BACKUP_HEARTBEAT_URL");
    expect(release).toContain("contents: write\n      id-token: write");
    expect(release).toContain("Mint GitHub OIDC token for Vercel Trusted Sources");
    expect(release).toContain("ACTIONS_ID_TOKEN_REQUEST_URL");
    expect(release).toContain("ACTIONS_ID_TOKEN_REQUEST_TOKEN");
    expect(release).toContain("audience=$VERCEL_TRUSTED_SOURCE_AUDIENCE");
    expect(release).toContain('echo "::add-mask::$oidc_token"');
    expect(release).toContain("VERCEL_TRUSTED_SOURCE_AUDIENCE: https://github.com/Starfie1d1272");
    expect(release).toContain("x-vercel-trusted-oidc-idp-token: $VERCEL_TRUSTED_OIDC_IDP_TOKEN");
    expect(release).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(release).not.toContain("protection-bypass");
    expect(release).not.toContain("x-vercel-protection-bypass");
    const smokeStart = release.indexOf("      - name: Smoke test production deployment");
    const schedulerStart = release.indexOf("      - name: Provision and verify production scheduler");
    const smoke = release.slice(smokeStart, schedulerStart);
    expect(smoke).toContain("^https://[a-z0-9][a-z0-9-]*\\.vercel\\.app/?$");
    expect(smoke).not.toContain("VERCEL_TOKEN");
    const canonicalIdentity = smoke.slice(smoke.indexOf("canonical_identity="));
    expect(canonicalIdentity).not.toContain("x-vercel-trusted-oidc-idp-token");
    const productionSerialization = "concurrency:\n  group: rivalhub-production-state-serialization\n  queue: max\n  cancel-in-progress: false";
    expect(backup).toContain(productionSerialization);
    expect(release).toContain(productionSerialization);
    expect(r2).not.toContain(productionSerialization);
    expect(backup).not.toContain("cancel-in-progress: true");
    expect(release).not.toContain("cancel-in-progress: true");
    expect(release).toContain("$RIVALHUB_PRODUCTION_BASE_URL/api/system/release");
    expect(release).toContain('(keys | sort) == ["releaseCommit", "releaseTag"]');
    expect(nextConfig).toContain("RIVALHUB_RELEASE_TAG: process.env.RIVALHUB_RELEASE_TAG ?? \"\"");
    expect(nextConfig).toContain("RIVALHUB_RELEASE_COMMIT: process.env.RIVALHUB_RELEASE_COMMIT ?? \"\"");
  });

  it("freezes the exact release identity into Vercel builds and reads it back after deploy", () => {
    const release = readProjectFile(".github/workflows/release.yml");
    const nextConfig = readProjectFile("next.config.ts");

    expect(release).toContain('--build-env RIVALHUB_RELEASE_TAG="$RELEASE_TAG"');
    expect(release).toContain('--build-env RIVALHUB_RELEASE_COMMIT="$RELEASE_SHA"');
    expect(release).toContain('deployment_identity="$(curl --fail');
    expect(release).toContain('"$DEPLOYMENT_URL/api/system/release"');
    expect(release).toContain("$RIVALHUB_PRODUCTION_BASE_URL/api/system/release");
    expect(release).toContain('(keys | sort) == ["releaseCommit", "releaseTag"]');
    expect(nextConfig).toContain('RIVALHUB_RELEASE_TAG: process.env.RIVALHUB_RELEASE_TAG ?? ""');
    expect(nextConfig).toContain('RIVALHUB_RELEASE_COMMIT: process.env.RIVALHUB_RELEASE_COMMIT ?? ""');
  });

  it("documents the current Vercel Trusted Source fields and raw claims", () => {
    const releaseRunbook = readProjectFile("docs/operations/release.md");
    const recoveryRunbook = readProjectFile("docs/operations/disaster-recovery.md");

    for (const runbook of [releaseRunbook, recoveryRunbook]) {
      expect(runbook).toContain("GitHub account | `Starfie1d1272`");
      expect(runbook).toContain("Repository | `RivalHub`");
      expect(runbook).toContain("Branch | 留空（release 使用版本 tag");
      expect(runbook).toContain("GitHub Actions environment | `production`");
      expect(runbook).toContain("Audience | `https://github.com/Starfie1d1272`");
      expect(runbook).toContain("Applies to environments | `Production`");
      expect(runbook).toContain("Edit raw claims");
      expect(runbook).toContain("`repository_id` | `1231811932`");
      expect(runbook).toContain("`workflow` | `Release`");
      expect(runbook).toContain("`environment` | `production`");
      expect(runbook).toContain("`sub` | `repo:Starfie1d1272/RivalHub:environment:production`");
      expect(runbook).toContain("`event_name` | `push`, `workflow_dispatch`");
      expect(runbook).toContain("不填写 `ref` 或 `workflow_ref`");
      expect(runbook).not.toContain("Workflow | `Release`");
      expect(runbook).not.toContain("Branch | `Any branch`");
    }
  });

  it("keeps recovery capability and destructive migration on separate release gates", () => {
    const releaseRunbook = readProjectFile("docs/operations/release.md");
    const recoveryRunbook = readProjectFile("docs/operations/disaster-recovery.md");

    expect(releaseRunbook).toContain("fetch");
    expect(releaseRunbook).toContain("temporary-sensitive/active-reference-only");
    expect(recoveryRunbook).toContain("30d");
    expect(recoveryRunbook).toContain("Cold-start provider configuration inventory");
    expect(releaseRunbook).toContain("production encrypted backup");
    expect(releaseRunbook).toContain("private R2 artifact/sidecar/completion PUT + HEAD + real GET/hash read-back");
    expect(releaseRunbook).toContain("local offline age private key decrypt");
    expect(releaseRunbook).not.toContain("PR `#577`");
    expect(recoveryRunbook).not.toContain("PR `#577`");
    expect(releaseRunbook).not.toContain("production/` bucket lock 7d");
    expect(recoveryRunbook).not.toContain("production/` bucket lock 7d");
  });

  it("uses main as the sole long-lived CI ref", () => {
    const ci = readProjectFile(".github/workflows/ci.yml");

    expect(ci).toContain("branches: [main]");
    expect(ci).not.toMatch(/branches:\s*\[[^\]]*\bdev\b/);
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
    expect(workflow).toContain("default: main");
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
    expect(ci).toContain("pnpm db:check");
    expect(ci).toContain("pnpm db:release-compat");
    expect(ci.indexOf("pnpm db:release-compat")).toBeGreaterThan(ci.indexOf("pnpm db:check"));
    expect(ci.indexOf("pnpm test:integration:pg17")).toBeGreaterThan(ci.indexOf("pnpm db:release-compat"));

    expect(release).toContain("fetch-depth: 0");
    expect(release).toContain("RIVALHUB_PRODUCTION_STABLE_REF: origin/main");
    expect(release).toContain("run: pnpm db:release-compat");
    expect(release.indexOf("run: pnpm db:release-compat")).toBeLessThan(release.indexOf("pnpm db:production:migrate"));
  });

  it("retries an immutable GitHub Release without editing its published metadata", () => {
    const release = readProjectFile(".github/workflows/release.yml");

    expect(release).toContain('gh release view "$RELEASE_TAG" --json isImmutable --jq .isImmutable');
    expect(release).toContain('Release $RELEASE_TAG is immutable; keeping published metadata.');
    expect(release).toMatch(
      /if \[\[ "\$\(gh release view "\$RELEASE_TAG" --json isImmutable --jq \.isImmutable\)" == "true" \]\]; then[\s\S]*?else[\s\S]*?gh release edit "\$RELEASE_TAG"/,
    );
    expect(release).toContain('gh release edit "$RELEASE_TAG"');
    expect(release).toContain('gh release create "$RELEASE_TAG"');
  });

  it("runs each production Cron endpoint independently with bounded retries", () => {
    const workflow = readProjectFile(".github/workflows/cron.yml");
    const jobKeys = [
      "draft-timeout",
      "check-registration-deadline",
      "match-time-auto-award",
      "cleanup-education-evidence",
    ];

    expect(workflow).toContain("fail-fast: false");
    expect(workflow).toContain("timeout-minutes: 5");
    expect(workflow).toContain("matrix:");
    for (const jobKey of jobKeys) expect(workflow).toContain(`- job_key: ${jobKey}`);
    expect(workflow).toContain("/api/cron/${CRON_JOB_KEY}");
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

  it("provisions the primary scheduler only after production smoke", () => {
    const release = readProjectFile(".github/workflows/release.yml");

    expect(release).toContain("Provision and verify production scheduler");
    expect(release).toContain("RIVALHUB_SCHEDULER_BASE_URL: https://match.starfie1d.top");
    expect(release).toContain("RIVALHUB_ALLOW_REMOTE_DB_WRITE=production pnpm db:production:scheduler:provision");
    expect(release).toContain("pnpm db:production:scheduler:verify");
    expect(release.indexOf("Smoke test production deployment")).toBeLessThan(release.indexOf("Provision and verify production scheduler"));
    expect(release.indexOf("Provision and verify production scheduler")).toBeLessThan(release.indexOf("Extract changelog for this version"));
  });
});
