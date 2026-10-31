import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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
    ['project_id = "rivalhub-scratch-571"\nproject_id = "rivalhub-scratch-571"\n', ["--project-id", "rivalhub-scratch-571"]],
    ['project_id = "rivalhub-scratch-571"\n', ["--project-id", "rivalhub-scratch-571", "--no-backup"]],
  ])("rejects unsafe or ambiguous targets before invoking the stub", (config, args) => {
    const result = runStop(config, args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("显式独立 scratch 项目");
    expect(() => readFileSync(result.receipt)).toThrow();
  });
});
