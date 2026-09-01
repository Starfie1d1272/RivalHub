import { describe, expect, it } from "vitest";
import { assertCompleteMigrationLedger, assertCurrentTerminalSchema } from "../../../scripts/db/verify-migrations";
import { assertActiveChainPrefix } from "../../../scripts/db/production-preflight";

const expected = [
  { hash: "first", when: 1 },
  { hash: "second", when: 2 },
];

describe("active Drizzle ledger verification", () => {
  it("accepts only the complete expected ledger", () => {
    expect(() => assertCompleteMigrationLedger(expected, expected)).not.toThrow();
  });

  it("fails closed for a pending migration, a divergent hash, or an unexpected ledger entry", () => {
    expect(() => assertCompleteMigrationLedger([expected[0]!], expected)).toThrow(/pending migration/);
    expect(() => assertCompleteMigrationLedger([{ hash: "other", when: 1 }, expected[1]!], expected)).toThrow(/hash divergence/);
    expect(() => assertCompleteMigrationLedger([...expected, { hash: "third", when: 3 }], expected)).toThrow(/unexpected migration/);
    expect(() => assertActiveChainPrefix([{ hash: "other", when: 1 }], expected)).toThrow(/精确前缀/);
  });

  it("requires the active terminal schema contract", () => {
    expect(() => assertCurrentTerminalSchema({ evidence_code: true, evidence_url: false, perfect_id: false, roles: ["igl", "awper", "opener", "closer", "anchor"] })).not.toThrow();
    expect(() => assertCurrentTerminalSchema({ evidence_code: false, evidence_url: true, perfect_id: true, roles: ["igl"] })).toThrow(/terminal schema contract/);
  });
});
