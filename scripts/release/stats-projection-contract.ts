import { execFileSync } from "node:child_process";
import { statisticsProjectionContractChanged } from "../../src/lib/stats/projection-contract";

const CONTRACT_PATH = "src/lib/stats/projection-contract.json";

/** Git transport only; statistics owns the meaning and validation of the declaration. */
export function statsProjectionContractChanged(cwd: string, previous: string, candidate: string): boolean {
  const read = (revision: string): unknown => {
    try {
      return JSON.parse(execFileSync("git", ["show", `${revision}:${CONTRACT_PATH}`], {
        cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      }));
    } catch {
      // Older releases lack this declaration. Do not execute or interpret their
      // TypeScript: one conservative backfill establishes current coverage.
      return undefined;
    }
  };
  return statisticsProjectionContractChanged(read(previous), read(candidate));
}
