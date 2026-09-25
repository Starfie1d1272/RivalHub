import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("scheduler watchdog planner CLI", () => {
  it("loads through the real package script without a top-level-await transform failure", () => {
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const result = spawnSync(pnpm, ["--silent", "db:production:scheduler:watchdog-plan"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: "" },
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("DATABASE_URL is required for scheduler watchdog planning.");
    expect(result.stderr).not.toContain("Top-level await is currently not supported");
  });
});
