import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(process.cwd());

function readProjectFile(path: string): string {
  return readFileSync(resolve(projectRoot, path), "utf8");
}

function readWorkflowJob(workflow: string, jobName: string): string {
  const match = workflow.match(new RegExp(`\\n  ${jobName}:\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:\\n|$)`));
  if (!match) throw new Error(`workflow job not found: ${jobName}`);
  return match[1];
}

function readWorkflowStep(job: string, stepName: string): string {
  const step = job.split(`      - name: ${stepName}\n`)[1]?.split("\n      - ")[0];
  if (!step) throw new Error(`workflow step not found: ${stepName}`);
  return step;
}

function expectOrderedSteps(workflow: string, before: string, after: string): void {
  const beforeIndex = workflow.indexOf(before);
  const afterIndex = workflow.indexOf(after);
  expect(beforeIndex, `missing release step: ${before}`).toBeGreaterThan(-1);
  expect(afterIndex, `missing release step: ${after}`).toBeGreaterThan(-1);
  expect(beforeIndex).toBeLessThan(afterIndex);
}

function runProductionMigrationStep(requiresRehearsal: boolean, failMigration = false) {
  const job = readWorkflowJob(readProjectFile(".github/workflows/release.yml"), "production_migration");
  const step = readWorkflowStep(job, "运行 production migration 与验证");
  const run = step.match(/\n        run: \|\n([\s\S]*)$/)?.[1];
  if (!run) throw new Error("production migration run script not found");
  const script = run.replace(/^ {10}/gm, "").replaceAll(
    "${{ needs.preflight.outputs.requires_migration_rehearsal }}",
    String(requiresRehearsal),
  );
  // Execute the workflow's actual shell branch without running any DB command.
  // GitHub's bash runner uses these same fail-fast shell options.
  return spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", `
    node() {
      printf '%s\\n' "$*"
      if [[ "$*" == *"db:production:migrate" && "$TEST_MIGRATION_FAILURE" == "true" ]]; then return 1; fi
    }
    ${script}
  `], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH,
      DATABASE_URL: "postgresql://release-test.invalid/unused",
      TEST_MIGRATION_FAILURE: String(failMigration),
    },
  });
}

describe("deployment and operations contracts", () => {
  it.each([false, true])("runs schema migration only when the release requires rehearsal (%s)", (requiresRehearsal) => {
    const result = runProductionMigrationStep(requiresRehearsal);

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      ...(requiresRehearsal
        ? ["scripts/ci/timing.mjs Production migration -- env RIVALHUB_ALLOW_REMOTE_DB_WRITE=production pnpm db:production:migrate"]
        : []),
      "scripts/ci/timing.mjs Production DB verify -- pnpm db:production:verify",
    ]);
  });

  it("does not advance to verification after a schema migration fails", () => {
    const result = runProductionMigrationStep(true, true);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("db:production:migrate");
    expect(result.stdout).not.toContain("db:production:verify");
  });

  it("requires protected projection backfill and coverage before candidate routing", () => {
    const release = readProjectFile(".github/workflows/release.yml");
    const migration = readWorkflowJob(release, "production_migration");
    const finalize = readWorkflowJob(release, "finalize");
    const backfill = readWorkflowStep(migration, "回填 production 每图统计投影");
    const coverage = readWorkflowStep(migration, "验证 production 统计投影覆盖");

    expect(migration).toContain("needs.preflight.outputs.requires_production_migration == 'true'");
    expect(migration).toContain("needs.migration_rehearsal.result == 'skipped'");
    expect(backfill).toContain("if: needs.preflight.outputs.requires_stats_projection_backfill == 'true'");
    expect(backfill).toContain("RIVALHUB_ALLOW_REMOTE_DB_WRITE: production");
    expect(backfill).toContain("RIVALHUB_STATS_PROJECTION_WRITE_CONFIRM: I_UNDERSTAND_STATS_PROJECTION_WRITE");
    expect(backfill).toContain("pnpm db:production:stats-projections:backfill --apply");
    expect(coverage).toContain("if: needs.preflight.outputs.requires_stats_projection_backfill == 'true'");
    expect(coverage).toContain("pnpm db:production:stats-projections:coverage");
    expect(coverage).not.toContain("RIVALHUB_ALLOW_REMOTE_DB_WRITE");
    expectOrderedSteps(migration, "回填 production 每图统计投影", "验证 production 统计投影覆盖");
    expect(finalize).toContain("needs.production_migration.result == 'success' || needs.production_migration.result == 'skipped'");
    expect(finalize).toContain("needs: [preflight, candidate_build, migration_rehearsal, checkpoint, production_migration]");
    expectOrderedSteps(finalize, "运行 exact candidate smoke test", "执行 release routing / rollback");
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
    expect(backup).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
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
    expectOrderedSteps(release, "创建 full release checkpoint", "运行 exact candidate smoke test");
    expect(release).toContain("pnpm db:recovery:checkpoint");
    expect(release).toContain("pnpm db:recovery:backup pre-release");
    const candidateBuild = readWorkflowJob(release, "candidate_build");
    const productionMigration = readWorkflowJob(release, "production_migration");
    const finalize = readWorkflowJob(release, "finalize");
    const remoteMigration = readProjectFile("scripts/db/remote.ts");
    expect(candidateBuild).toContain("部署 Vercel candidate");
    expect(candidateBuild).not.toContain("candidate smoke");
    expect(productionMigration).toContain("运行 production migration 与验证");
    expect(release).toContain("release_operator_sha: ${{ steps.release_identity.outputs.release_operator_sha }}");
    expect(release).toContain('if [[ "$GITHUB_REF" != "refs/heads/main" ]]; then');
    expect(release).toContain('MAIN_SHA="$(git rev-parse origin/main)"');
    expect(release).toContain('if [[ "$GITHUB_SHA" != "$MAIN_SHA" ]]; then');
    expect(release).toContain('echo "release_operator_sha=$RELEASE_OPERATOR_SHA" >> "$GITHUB_OUTPUT"');
    expect(release).toContain("验证 release operator exact-SHA CI prerequisite");
    expect(release).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(release).toContain("RELEASE_SHA: ${{ steps.release_identity.outputs.release_operator_sha }}");
    expect(productionMigration).toContain(
      "ref: ${{ github.event_name == 'workflow_dispatch' && needs.preflight.outputs.release_operator_sha || needs.preflight.outputs.release_tag }}",
    );
    expect(productionMigration).toContain("验证 release operator 与 candidate migration chain");
    expect(productionMigration).toContain("RELEASE_OPERATOR_SHA: ${{ needs.preflight.outputs.release_operator_sha }}");
    expect(productionMigration).not.toContain("github.sha");
    expect(productionMigration).toContain('git diff --quiet "$RELEASE_TAG" "$RELEASE_OPERATOR_SHA"');
    expect(productionMigration).toContain("drizzle/migrations");
    expect(productionMigration).toContain("drizzle.production.config.ts");
    expect(productionMigration).toContain(
      "RIVALHUB_RELEASE_MIGRATION_REHEARSAL: ${{ needs.migration_rehearsal.result == 'success' && 'pg17' || '' }}",
    );
    expect(remoteMigration).toContain('"scripts/db/local.ts", "migrate"');
    expect(remoteMigration).toContain('"scripts/db/local.ts", "verify-migrations"');
    expect(remoteMigration).toContain("shouldUseExternalReleaseMigrationRehearsal");
    expect(release).toContain("requires_steam_profile_backfill: ${{ steps.plan.outputs.requiresSteamProfileBackfill }}");
    expect(productionMigration).toContain("pnpm db:production:steam-profile:backfill --apply");
    expect(productionMigration).not.toContain("pnpm db:production:steam-profile:backfill -- --apply");
    expect(productionMigration).toContain("pnpm db:production:steam-profile:coverage");
    expect(productionMigration).toContain("STEAM_API_KEY: ${{ secrets.STEAM_API_KEY }}");
    expect(productionMigration).toContain("RIVALHUB_STEAM_PROFILE_WRITE_CONFIRM: I_UNDERSTAND_STEAM_PROFILE_CACHE_WRITE");
    expectOrderedSteps(release, "运行 production migration 与验证", "回填 production Steam profile cache");
    expectOrderedSteps(release, "回填 production Steam profile cache", "验证 production Steam profile coverage");
    expectOrderedSteps(release, "验证 production Steam profile coverage", "运行 exact candidate smoke test");
    expectOrderedSteps(release, "运行 production migration 与验证", "运行 exact candidate smoke test");
    expectOrderedSteps(finalize, "运行 exact candidate smoke test", "执行 release routing / rollback");
    expect(release).toContain("SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}");
    expect(release).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
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
    expect(readProjectFile(".github/workflows/ci.yml")).toContain("mobile_search_evidence: ${{ steps.plan.outputs.mobile_search_evidence }}");
  });

  it("freezes the exact release identity into Vercel builds and reads it back after deploy", () => {
    const release = readProjectFile(".github/workflows/release.yml");
    const nextConfig = readProjectFile("next.config.ts");

    expect(release).toContain('--build-env RIVALHUB_RELEASE_TAG="$RELEASE_TAG"');
    expect(release).toContain('--build-env RIVALHUB_RELEASE_COMMIT="$RELEASE_SHA"');
    expect(release).toContain('deployment_identity="$(curl --fail');
    expect(release).toContain('"$DEPLOYMENT_URL/api/system/release"');
    expect(nextConfig).toContain('RIVALHUB_RELEASE_TAG: process.env.RIVALHUB_RELEASE_TAG ?? ""');
    expect(nextConfig).toContain('RIVALHUB_RELEASE_COMMIT: process.env.RIVALHUB_RELEASE_COMMIT ?? ""');
  });

  it("uses main as the sole long-lived CI ref", () => {
    const ci = readProjectFile(".github/workflows/ci.yml");

    expect(ci).toContain("branches: [main]");
    expect(ci).not.toMatch(/branches:\s*\[[^\]]*\bdev\b/);
  });

  it("declares the single Vercel Function region and disables automatic Git deployments", () => {
    const config = JSON.parse(readProjectFile("vercel.json")) as {
      buildCommand?: string;
      regions?: string[];
      git?: { deploymentEnabled?: boolean | Record<string, boolean> };
    };

    expect(config.buildCommand).toBe("tsx scripts/vercel-build.ts");
    expect(config.regions).toEqual(["hnd1"]);
    expect(config.git?.deploymentEnabled).toBe(false);
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
    expect(workflow).toContain("RIVALHUB_STAGING_PROJECT_CONFIRM: tpbqpbnuonnubiyfdrfe");
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
    expectOrderedSteps(release, "冻结 previous Production identity", "验证 exact-SHA CI prerequisite");
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

  it("plans scheduled watchdog fallbacks before invoking Vercel and keeps manual dispatch forced", () => {
    const workflow = readProjectFile(".github/workflows/cron.yml");

    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("DATABASE_URL: ${{ secrets.DATABASE_URL }}");
    expect(workflow).toContain("db:production:scheduler:watchdog-plan");
    expect(workflow).toContain("Primary scheduler is healthy; no Vercel fallback required.");
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("github-manual");
    expect(workflow).toContain("github-watchdog");
    expect(workflow).toContain("/api/cron/${CRON_JOB_KEY}");
    expect(workflow).toContain("CRON_SECRET: ${{ secrets.CRON_SECRET }}");
    expect(workflow).toContain('Authorization: Bearer ${CRON_SECRET}');
    expect(workflow).toContain("--connect-timeout 10");
    expect(workflow).toContain("--max-time 60");
    expect(workflow).toContain("--retry 2");
    expect(workflow).toContain("--retry-all-errors");
    expect(workflow).toContain("watchdog-plan freeze");
    expect(workflow).toContain("steps.production.outputs.release_commit");
    expect(workflow).toContain("watchdog-plan verify");
    expect(workflow).not.toContain("ALL='");
    expect(workflow).not.toContain("reconcile-predictions");
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
    expectOrderedSteps(finalize, "执行 release routing / rollback", "配置并验证 production scheduler");
    expect(finalize).toContain("生成 Production delta release notes");
    expectOrderedSteps(finalize, "配置并验证 production scheduler", "生成 Production delta release notes");
    expect(finalize).toContain("if: env.REQUIRES_SCHEDULER_PROVISION == 'true'");
    expect(finalize).not.toContain("env.RELEASE_MODE == 'fresh' &&");

    // Verify bash -c fail-fast safety
    const schedulerStep = finalize.slice(
      finalize.indexOf("配置并验证 production scheduler"),
      finalize.indexOf("生成 Production delta release notes"),
    );
    expect(schedulerStep).toMatch(/bash -c '\s*set -euo pipefail/);
  });

  it("keeps CI cancellation and staged release orchestration isolated", () => {
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

    // Preflight must exist and precede the checkpoint before DB mutation.
    const migrateIdx = release.indexOf("运行 production migration 与验证");
    expectOrderedSteps(release, "验证 exact-SHA CI prerequisite", "创建 full release checkpoint");
    expect(migrateIdx).toBeGreaterThan(-1);

    // The controller and provider behavior are covered by routing and provider tests.
    expect(finalize).toContain("pnpm release:routing");

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
  });
});
