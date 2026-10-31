import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = process.cwd();
const workspaces: string[] = [];
function runStop(config: string, args: string[]) {
  const cwd = mkdtempSync(resolve(tmpdir(), "rivalhub-stop-test-"));
  workspaces.push(cwd);
  mkdirSync(resolve(cwd, "supabase"), { recursive: true });
  mkdirSync(resolve(cwd, "node_modules/.bin"), { recursive: true });
  writeFileSync(resolve(cwd, "supabase/config.toml"), config);
  const receipt = resolve(cwd, "called");
  writeFileSync(resolve(cwd, "node_modules/.bin/supabase"), `#!/bin/sh\nprintf '%s\\n' "$@" > '${receipt}'\n`, { mode: 0o755 });
  const result = spawnSync(process.execPath, ["--import", resolve(root, "node_modules/tsx/dist/loader.mjs"), resolve(root, "scripts/db/local.ts"), "stop", ...args], { cwd, encoding: "utf8" });
  return { status: result.status, receipt, stderr: result.stderr };
}
afterEach(() => { for (const path of workspaces.splice(0)) rmSync(path, { recursive: true, force: true }); });
describe("local stop target", () => {
  it("calls the stub only for an explicit scratch ID matching the current config", () => {
    const result = runStop('project_id = "rivalhub-scratch-571"\n', ["--", "--project-id", "rivalhub-scratch-571"]);
    expect(result.status).toBe(0);
    expect(readFileSync(result.receipt, "utf8")).toBe("stop\n--project-id\nrivalhub-scratch-571\n");
  });
  it.each([
    ['project_id = "rivalhub"\n', []],
    ['project_id = "rivalhub"\n', ["--project-id", "rivalhub"]],
    ['project_id = "rivalhub-scratch-571"\n', ["--project-id", "rivalhub-scratch-other"]],
    ['project_id = "rivalhub-scratch-571"\n', []],
    ['[other]\nproject_id = "rivalhub-scratch-571"\n', ["--project-id", "rivalhub-scratch-571"]],
    ['project_id = "rivalhub-scratch-571"\nproject_id = \'rivalhub\'\n', ["--project-id", "rivalhub-scratch-571"]],
    ['project_id = "rivalhub-scratch-571"\n"project_id" = "rivalhub"\n', ["--project-id", "rivalhub-scratch-571"]],
    ['project_id = "rivalhub-scratch-571"\nproject_id = "rivalhub-scratch-571"\n', ["--project-id", "rivalhub-scratch-571"]],
    ['project_id = "rivalhub-scratch-571"\n', ["--project-id", "rivalhub-scratch-571", "--no-backup"]],
  ])("rejects unsafe or ambiguous targets before invoking the stub", (config, args) => {
    const result = runStop(config, args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("显式独立 scratch 项目");
    expect(() => readFileSync(result.receipt)).toThrow();
  });
});


it("staging prepares and cleans up the same run-specific scratch project", () => {
  const workflow = parse(readFileSync(resolve(root, ".github/workflows/staging.yml"), "utf8"));
  const job = workflow.jobs.staging;
  expect(job.env.RIVALHUB_LOCAL_PROJECT_ID).toBe("rivalhub-scratch-staging-${{ github.run_id }}-${{ github.run_attempt }}");
  const prepare = job.steps.find((step: { name?: string }) => step.name === "Select isolated local project");
  const cleanup = job.steps.find((step: { name?: string }) => step.name === "Stop Local PostgreSQL");
  expect(cleanup.run).toContain('pnpm db:local:stop -- --project-id "$RIVALHUB_LOCAL_PROJECT_ID"');
  const cwd = mkdtempSync(resolve(tmpdir(), "rivalhub-staging-test-"));
  workspaces.push(cwd);
  mkdirSync(resolve(cwd, "supabase"));
  writeFileSync(resolve(cwd, "supabase/config.toml"), readFileSync(resolve(root, "supabase/config.toml")));
  const id = "rivalhub-scratch-staging-123-1";
  const result = spawnSync("bash", ["-e", "-c", prepare.run], { cwd, env: { ...process.env, RIVALHUB_LOCAL_PROJECT_ID: id }, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  const stop = runStop(readFileSync(resolve(cwd, "supabase/config.toml"), "utf8"), ["--", "--project-id", id]);
  expect(stop.status).toBe(0);
  expect(readFileSync(stop.receipt, "utf8")).toBe(`stop\n--project-id\n${id}\n`);
});
