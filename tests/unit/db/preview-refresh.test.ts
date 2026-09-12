import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { importAndMigrateSnapshot } from "../../../scripts/db/preview/refresh";
import type { MirrorSnapshot } from "../../../scripts/db/preview/snapshot";

describe("preview mirror refresh", () => {
  it("imports production-derived rows before applying current migrations", async () => {
    const phases: string[] = [];
    let value = "empty";

    await importAndMigrateSnapshot({} as PoolClient, {} as MirrorSnapshot, true, {
      importSnapshot: async () => { value = "production-derived"; phases.push("import"); },
      verify: async () => { phases.push(`verify:${value}`); },
      migrateCurrent: async () => {
        expect(value).toBe("production-derived");
        value = "current-migration";
        phases.push("migrate");
      },
    });

    expect(phases).toEqual([
      "import",
      "verify:production-derived",
      "migrate",
      "verify:current-migration",
    ]);
  });
});
