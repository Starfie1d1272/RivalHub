import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { it } from "vitest";

// Exercise the real shell/filesystem transaction and tar implementation with tiny fixtures.
// No database, systemd changes, remote host or application server is started.
it("preserves Linux package identity and rollback across layered transfer faults", () => {
  const result = spawnSync(process.execPath, ["--test", resolve("scripts/standby/install-production.test.mjs"), resolve("scripts/standby/production-quiescence.test.mjs")], {
    encoding: "utf8", timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Linux package fixture failed (${result.signal ?? result.status}):\n${result.stdout}\n${result.stderr}`, { cause: result.error });
}, 65_000);
