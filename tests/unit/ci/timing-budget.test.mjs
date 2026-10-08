import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

// A missing timestamp must not masquerade as a zero-second successful gate.
it.each([
  ["1000", "181000", 0],
  ["1000", "181001", 1],
  ["invalid", "181000", 1],
  ["181000", "1000", 1],
])("checks the complete interval %s → %s", (start, end, status) => {
  const directory = mkdtempSync(join(tmpdir(), "ci-budget-"));
  try {
    const result = spawnSync(process.execPath, ["scripts/ci/timing.mjs", "record", "--label", "gate", "--start-ms", start, "--end-ms", end, "--budget-ms", "180000"], {
      encoding: "utf8", env: { ...process.env, RIVALHUB_TIMING_FILE: join(directory, "timing.jsonl") },
    });
    expect(result.status).toBe(status);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
