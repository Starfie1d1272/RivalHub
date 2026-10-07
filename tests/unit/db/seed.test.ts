import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import { seed } from "@/db/seed";

describe("application seed", () => {
  it("rejects an undeclared target before importing application seed", () => {
    const env = { ...process.env };
    delete env.RIVALHUB_DB_TARGET;
    env.DATABASE_URL = "postgresql://seed-test.invalid/unused";
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/seed.ts"], { env, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("RIVALHUB_DB_TARGET");
    expect(result.stdout).not.toContain("seed.no_application_rows");
  });
  afterEach(() => vi.restoreAllMocks());

  it("does not create administrator or other application rows", async () => {
    const logSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(seed()).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledOnce();
    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toMatchObject({
      event: "seed.no_application_rows",
      message: "No application seed rows configured.",
    });
  });
});
