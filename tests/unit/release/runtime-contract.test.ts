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
    expectPnpmSetup(release, ["preflight", "migration_rehearsal", "checkpoint", "candidate_build", "production_migration", "finalize"]);
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
    expect(backup).not.toContain("inputs:");
    expect(backup).not.toContain("backup_class:");
    expect(backup).not.toContain("upload-artifact");

    expect(r2).toContain("type: choice");
    expect(r2).toContain("pnpm db:recovery:r2:verify");
    expect(r2).toContain("pnpm db:recovery:r2:apply");
    expect(r2).toContain("environment: production");

    expect(release).toContain("创建 DB-only release checkpoint");
    expect(release).toContain("创建 full release checkpoint");
    expect(release).toContain("RIVALHUB_PRODUCTION_BASE_URL: https://match.starfie1d.top");
    expect(release.indexOf("创建 full release checkpoint")).toBeLessThan(release.indexOf("运行 exact candidate smoke test"));
    expect(release).toContain("pnpm db:recovery:checkpoint");
    expect(release).toContain("pnpm db:recovery:backup pre-release");
    const candidateBuild = readWorkflowJob(release, "candidate_build");
    const productionMigration = readWorkflowJob(release, "production_migration");
    const finalize = readWorkflowJob(release, "finalize");
    expect(candidateBuild).toContain("部署 Vercel candidate");
    expect(candidateBuild).not.toContain("candidate smoke");
    expect(productionMigration).toContain("运行 production migration 与验证");
    expect(release).toContain("requires_steam_profile_backfill: ${{ steps.plan.outputs.requiresSteamProfileBackfill }}");
    expect(productionMigration).toContain("pnpm db:production:steam-profile:backfill -- --apply");
    expect(productionMigration).toContain("pnpm db:production:steam-profile:coverage");
    expect(productionMigration).toContain("STEAM_API_KEY: ${{ secrets.STEAM_API_KEY }}");
    expect(productionMigration).toContain("RIVALHUB_STEAM_PROFILE_WRITE_CONFIRM: I_UNDERSTAND_STEAM_PROFILE_CACHE_WRITE");
    expect(release.indexOf("运行 production migration 与验证")).toBeLessThan(release.indexOf("回填 production Steam profile cache"));
    expect(release.indexOf("回填 production Steam profile cache")).toBeLessThan(release.indexOf("验证 production Steam profile coverage"));
    expect(release.indexOf("验证 production Steam profile coverage")).toBeLessThan(release.indexOf("运行 exact candidate smoke test"));
    expect(release.indexOf("运行 production migration 与验证")).toBeLessThan(release.indexOf("运行 exact candidate smoke test"));
    expect(finalize.indexOf("运行 exact candidate smoke test")).toBeLessThan(finalize.indexOf("执行 release routing / rollback"));
    expect(release).toContain("SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}");
    expect(release).toContain("SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}");
    expect(release).not.toContain("RIVALHUB_BACKUP_HEARTBEAT_URL");
    expect(candidateBuild).toContain("contents: read");
    expect(candidateBuild).not.toContain("id-token: write");
    expect(finalize).toContain("获取 Vercel Trusted Source OIDC token");
    expect(finalize).toContain("ACTIONS_ID_TOKEN_REQUEST_URL");
    expect(finalize).toContain("ACTIONS_ID_TOKEN_REQUEST_TOKEN");
    expect(finalize).toContain("audience=$VERCEL_TRUSTED_SOURCE_AUDIENCE");
    expect(finalize).toContain('echo "::add-mask::$oidc_token"');
    expect(finalize).toContain("VERCEL_TRUSTED_SOURCE_AUDIENCE: https://github.com/Starfie1d1272");
    expect(finalize).toContain("x-vercel-trusted-oidc-idp-token: $VERCEL_TRUSTED_OIDC_IDP_TOKEN");
    expect(release).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(release).not.toContain("protection-bypass");
    expect(release).not.toContain("x-vercel-protection-bypass");
    const smokeStart = finalize.indexOf("      - name: 运行 exact candidate smoke test");
    const routingStart = finalize.indexOf("      - name: 执行 release routing / rollback");
    const smoke = finalize.slice(smokeStart, routingStart);
    expect(smoke).toContain("^https://[a-z0-9][a-z0-9-]*\\.vercel\\.app/?$");
    const candidateSmoke = smoke;
    expect(candidateSmoke).not.toContain("VERCEL_TOKEN");
    expect(candidateSmoke).toContain("x-vercel-trusted-oidc-idp-token: $VERCEL_TRUSTED_OIDC_IDP_TOKEN");
    expect(finalize).toContain("执行 release routing / rollback");
    expect(finalize).toContain("pnpm release:routing");
    expect(release).toContain("requiresFullCheckpoint");
    expect(release).toContain("requiresSchedulerProvision");
    const checkpointJob = readWorkflowJob(release, "checkpoint");
    const dbOnlyCheckpoint = checkpointJob.slice(0, checkpointJob.indexOf("- name: 创建 full release checkpoint"));
    expect(dbOnlyCheckpoint).not.toContain("SUPABASE_SECRET_KEY");
    const productionSerialization = /concurrency:\n\s+group: rivalhub-production-state-serialization\n\s+queue: max\n\s+cancel-in-progress: false/;
    expect(backup).toMatch(productionSerialization);
    expect(productionMigration).toMatch(productionSerialization);
    expect(finalize).toContain("rivalhub-production-state-serialization");
    expect(release).toContain("group: rivalhub-release-lineage");
    expect(r2).not.toContain(productionSerialization);
    expect(backup).not.toContain("cancel-in-progress: true");
    expect(release).not.toContain("cancel-in-progress: true");
    expect(nextConfig).toContain("RIVALHUB_RELEASE_TAG: process.env.RIVALHUB_RELEASE_TAG ?? \"\"");
    expect(nextConfig).toContain("RIVALHUB_RELEASE_COMMIT: process.env.RIVALHUB_RELEASE_COMMIT ?? \"\"");
    expect(release).not.toMatch(/^concurrency:\n  group: rivalhub-production-state-serialization/m);
    expect(readWorkflowJob(release, "migration_rehearsal")).toContain("needs: preflight");
    expect(readWorkflowJob(release, "checkpoint")).toContain("needs: preflight");
    const preflight = readWorkflowJob(release, "preflight");
    expect(preflight).toContain("workflow_started_at: ${{ steps.workflow_start.outputs.started_at }}");
    expect(preflight).toContain("id: workflow_start");
    expect(candidateBuild).toContain("needs: preflight");
    expect(productionMigration).toContain("needs: [preflight, candidate_build, migration_rehearsal, checkpoint]");
    expect(finalize).toContain("needs: [preflight, candidate_build, migration_rehearsal, checkpoint, production_migration]");
    expect(finalize).toContain("contents: write");
    expect(release).toMatch(/^concurrency:\n  group: rivalhub-release-lineage\n  queue: max\n  cancel-in-progress: false/m);
    expect(finalize).toContain("RELEASE_WORKFLOW_STARTED_AT: ${{ needs.preflight.outputs.workflow_started_at }}");
    expect(finalize).toContain("--start-iso \"$RELEASE_WORKFLOW_STARTED_AT\"");
    expect(finalize).toContain("if: env.REQUIRES_SCHEDULER_PROVISION == 'true'");
    expect(finalize).not.toContain("env.RELEASE_MODE == 'fresh' && env.REQUIRES_SCHEDULER_PROVISION");
    expect(finalize).toContain("needs.preflight.outputs.requires_scheduler_provision == 'true' && 'rivalhub-production-state-serialization'");
    expect(finalize).toContain("format('rivalhub-release-post-promotion-{0}', github.run_id)");
    expect(release).not.toContain("application_changed:");
    expect(release).not.toContain("migration_changed:");
    expect(release).not.toContain("release-finalize.yml");
    expect(readProjectFile(".github/workflows/ci.yml")).toContain("Mobile public event search evidence (10x, no retry)");
    expect(readProjectFile(".github/workflows/ci.yml")).toContain("mobile_search_evidence: ${{ steps.plan.outputs.mobile_search_evidence }}");
    expect(readProjectFile(".github/workflows/ci.yml")).toContain("PLAYWRIGHT_RETRIES: 0");
    expect(readProjectFile(".github/workflows/ci.yml")).toContain("--repeat-each=10");
  });

  it("freezes the exact release identity into Vercel builds and reads it back after deploy", () => {
    const release = readProjectFile(".github/workflows/release.yml");
    const routing = readProjectFile("scripts/release/routing.ts");
    const vercelRouting = readProjectFile("scripts/release/vercel-routing.ts");
    const nextConfig = readProjectFile("next.config.ts");

    expect(release).toContain('--build-env RIVALHUB_RELEASE_TAG="$RELEASE_TAG"');
    expect(release).toContain('--build-env RIVALHUB_RELEASE_COMMIT="$RELEASE_SHA"');
    expect(release).toContain('deployment_identity="$(curl --fail');
    expect(release).toContain('"$DEPLOYMENT_URL/api/system/release"');
    expect(routing).toContain("/api/system/release");
    expect(routing).toContain("assertReleaseIdentity");
    expect(routing).toContain("createVercelRoutingClient");
    expect(vercelRouting).toContain("DEFAULT_REQUEST_TIMEOUT_MS = 15_000");
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

    expect(releaseRunbook).toContain("offline read-only fetch");
    expect(releaseRunbook).toContain("temporary-sensitive/active-reference-only");
    expect(recoveryRunbook).toContain("30d");
    expect(recoveryRunbook).toContain("Cold-start provider configuration inventory");
    expect(releaseRunbook).toContain("production encrypted backup");
    expect(releaseRunbook).toContain("private R2 artifact/sidecar/completion PUT + HEAD + real GET/hash read-back");
    expect(releaseRunbook).toContain("local offline age private key decrypt");
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

  it("keeps the production build hermetic", () => {
    const build = readProjectFile("scripts/vercel-build.ts");
    const hermeticBuild = readProjectFile("scripts/ci/hermetic-production-build.mjs");

    expect(build).toContain("assertProductionReleaseBuild");
    expect(build).toContain("next${binSuffix}");
    expect(build).not.toContain("verify-migrations");
    expect(build).not.toContain("PRODUCTION_DATABASE_URL");
    expect(build).not.toContain("SUPABASE_SECRET_KEY");
    expect(hermeticBuild).toContain('VERCEL_ENV: "production"');
    expect(hermeticBuild).toContain('NODE_ENV: "production"');
    expect(hermeticBuild).toContain('__NEXT_PROCESSED_ENV: "true"');
    expect(hermeticBuild).toContain('RIVALHUB_RELEASE_TAG: "v0.0.0-ci"');
    expect(hermeticBuild).toContain('"DATABASE_URL"');
    expect(hermeticBuild).toContain('"SUPABASE_SERVICE_ROLE_KEY"');
    expect(readProjectFile("scripts/ci/run-static-task.mjs")).toContain("hermetic-production-build.mjs");
    expect(readProjectFile("playwright.config.ts")).toContain("PLAYWRIGHT_RETRIES");
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
    const productionIdentity = readProjectFile("scripts/release/production-identity.ts");

    expect(ci).toContain("fetch-depth: 0");
    expect(ci).toContain("RIVALHUB_MIGRATION_BASE_SHA:");
    expect(ci).toContain("RIVALHUB_PRODUCTION_STABLE_REF: origin/main");
    expect(ci).toContain("git fetch origin main --tags");
    expect(ci).toContain("pnpm db:check");
    expect(ci).toContain("pnpm db:release-compat");
    expect(ci.indexOf("pnpm db:release-compat")).toBeGreaterThan(ci.indexOf("pnpm db:check"));
    expect(ci.indexOf("pnpm test:integration:pg17")).toBeGreaterThan(ci.indexOf("pnpm db:release-compat"));

    expect(release).toContain("fetch-depth: 0");
    expect(release).toContain("冻结 previous Production identity");
    expect(release).toContain("pnpm release:freeze-identity");
    expect(productionIdentity).toContain("RIVALHUB_PREVIOUS_RELEASE_TAG");
    expect(productionIdentity).toContain("RIVALHUB_PREVIOUS_RELEASE_COMMIT");
    expect(release).not.toContain("RIVALHUB_PRODUCTION_STABLE_REF: origin/main");
    expect(release).toContain("pnpm db:release-compat");
    expect(readWorkflowJob(release, "production_migration")).toContain("pnpm db:production:migrate");
    expect(release.indexOf("冻结 previous Production identity")).toBeLessThan(release.indexOf("验证 exact-SHA CI prerequisite"));
  });

  it("retries an immutable GitHub Release without editing its published metadata", () => {
    const release = readProjectFile(".github/workflows/release.yml");

    expect(release).toContain('gh release view "$RELEASE_TAG" --json isImmutable --jq .isImmutable');
    expect(release).toContain('GitHub Release $RELEASE_TAG 已 immutable；保留已发布 metadata。');
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

  it("provisions the primary scheduler only after production smoke with strict fail-fast", () => {
    const release = readProjectFile(".github/workflows/release.yml");
    const finalize = readWorkflowJob(release, "finalize");

    expect(finalize).toContain("配置并验证 production scheduler");
    expect(finalize).toContain("RIVALHUB_SCHEDULER_BASE_URL: https://match.starfie1d.top");
    expect(finalize).toContain("RIVALHUB_ALLOW_REMOTE_DB_WRITE=production pnpm db:production:scheduler:provision");
    expect(finalize).toContain("pnpm db:production:scheduler:verify");
    expect(finalize.indexOf("执行 release routing / rollback")).toBeLessThan(finalize.indexOf("配置并验证 production scheduler"));
    expect(finalize).toContain("生成 Production delta release notes");
    expect(finalize.indexOf("配置并验证 production scheduler")).toBeLessThan(finalize.indexOf("生成 Production delta release notes"));
    expect(finalize).toContain("if: env.REQUIRES_SCHEDULER_PROVISION == 'true'");
    expect(finalize).not.toContain("env.RELEASE_MODE == 'fresh' &&");

    // Verify bash -c fail-fast safety
    const schedulerStep = finalize.slice(
      finalize.indexOf("配置并验证 production scheduler"),
      finalize.indexOf("生成 Production delta release notes"),
    );
    expect(schedulerStep).toMatch(/bash -c '\s*set -euo pipefail/);
  });

  it("enforces Issue #603 release orchestration and CI convergence contract", () => {
    const ci = readProjectFile(".github/workflows/ci.yml");
    const release = readProjectFile(".github/workflows/release.yml");
    const finalize = readWorkflowJob(release, "finalize");

    // CI triggers & concurrency
    expect(ci).not.toMatch(/^\s+release:\s*$/m);
    expect(ci).toContain("group: ci-${{ github.workflow }}-${{ github.event_name }}-${{ github.event.pull_request.number || (github.event_name == 'push' && github.sha || github.ref) }}");
    expect(ci).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");

    // Release runner & permissions
    expect(release).not.toContain("uses: ./.github/workflows/release-finalize.yml");
    expect(release).toContain("group: rivalhub-release-lineage");
    expect(finalize).toContain("runs-on: ubuntu-24.04");

    // Ordering: dependency setup before preflight, preflight before backup and DB mutations
    const pnpmSetupIdx = release.indexOf("uses: pnpm/setup");
    const ciPrereqIdx = release.indexOf("验证 exact-SHA CI prerequisite");
    const checkpointIdx = release.indexOf("创建 full release checkpoint");
    const migrateIdx = release.indexOf("运行 production migration 与验证");
    expect(pnpmSetupIdx).toBeGreaterThan(0);
    expect(pnpmSetupIdx).toBeLessThan(ciPrereqIdx);
    expect(ciPrereqIdx).toBeLessThan(checkpointIdx);
    expect(migrateIdx).toBeGreaterThan(-1);

    // Knip entries registration
    const knipConfig = JSON.parse(readProjectFile("knip.json")) as { entry: string[] };
    expect(knipConfig.entry).toContain("scripts/release/ci-prerequisite.ts!");
    expect(knipConfig.entry).toContain("scripts/release/production-identity.ts!");
    expect(knipConfig.entry).toContain("scripts/release/changelog.ts!");
    expect(knipConfig.entry).toContain("scripts/release/production-deployment.ts!");
    expect(knipConfig.entry).toContain("scripts/release/routing.ts!");

    // Routing state machine ownership and workflow wiring
    const routing = readProjectFile("scripts/release/routing.ts");
    const vercelRouting = readProjectFile("scripts/release/vercel-routing.ts");
    expect(finalize).toContain("执行 release routing / rollback");
    expect(finalize).toContain("pnpm release:routing");
    expect(release).not.toContain("wait_for_alias_job");
    expect(release).not.toContain("PREVIOUS_IDENTITY");
    expect(release).not.toContain("PROMOTE_STATUS");
    expect(release).not.toContain("ROLLBACK_STATUS");
    expect(vercelRouting).toContain("https://api.vercel.com/v13/deployments/");
    expect(vercelRouting).toContain("https://api.vercel.com/v10/projects/");
    expect(vercelRouting).toContain("https://api.vercel.com/v1/projects/");
    expect(vercelRouting).toContain("lastAliasRequest");
    expect(vercelRouting).toContain("AbortController");
    expect(vercelRouting).toContain("requestTimeoutMs");
    expect(vercelRouting).toContain('"retry-after"');
    expect(routing).toContain("DEFAULT_ROUTING_PROVIDER_TIMEOUT_MS = 180_000");
    expect(routing).toContain("DEFAULT_ROUTING_SEMANTIC_TIMEOUT_MS = 120_000");
    expect(routing).toContain("DEFAULT_ROUTING_AMBIGUOUS_RECONCILIATION_TIMEOUT_MS = 15_000");
    expect(routing).toContain("stablePreviousObservations");
    expect(routing).toContain("reconciliationWindowSafeToRetry");
    expect(routing).toContain("elapsedMs >= timeoutMs");
    expect(routing).toContain("rate_limited");
    expect(routing).toContain("convergence_timeout");
    expect(routing).toContain("rollback_failed");
    expect(routing).toContain("previousReleaseTag");
    expect(routing).toContain("previousReleaseCommit");

    // DB-only local rehearsal
    expect(release).toContain("image: postgres:17");
    expect(release).toContain("pnpm db:release-rehearsal");
    expect(readProjectFile("scripts/db/release-rehearsal.ts")).toContain("scripts/db/verify-migrations.ts");
    expect(readProjectFile("scripts/db/release-rehearsal.ts")).not.toContain("scripts/db/verify-db.ts");
    expect(release).not.toContain("pnpm db:local:start-db");
    expect(release).not.toContain("pnpm db:local:start\n");
    expect(release).not.toContain("pnpm db:local:stop");

    // Staged production deployment and promotion
    expect(release).toContain("vercel deploy --prod --skip-domain");
    expect(finalize).not.toContain('vercel promote "$DEPLOYMENT_URL" --yes');
    expect(finalize).not.toContain("vercel rollback --yes");

    // Phase timing evidence
    expect(release).toContain('RIVALHUB_TIMING_TITLE: "Release 阶段耗时"');
    expect(finalize).toContain('node scripts/ci/timing.mjs record --label "Total" --start-iso "$RELEASE_WORKFLOW_STARTED_AT"');
  });
});
