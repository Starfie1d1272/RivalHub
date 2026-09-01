import { describe, expect, it } from "vitest";
import {
  PRODUCTION_BASELINE_TAG,
  assertResumableProductionLedger,
  type ExpectedMigration,
  type Migration,
} from "../../../scripts/db/production-preflight";

const expected: ExpectedMigration[] = [
  { tag: "0022_example", hash: "h22", when: 22 },
  { tag: "0023_example", hash: "h23", when: 23 },
  { tag: PRODUCTION_BASELINE_TAG, hash: "h24", when: 24 },
  { tag: "0025_example", hash: "h25", when: 25 },
  { tag: "0026_example", hash: "h26", when: 26 },
  { tag: "0027_example", hash: "h27", when: 27 },
];

const prefix = (length: number): Migration[] =>
  expected.slice(0, length).map(({ hash, when }) => ({ hash, when }));

describe("production migration preflight ledger policy", () => {
  it("accepts the exact confirmed baseline and requests baseline-specific predicates", () => {
    expect(assertResumableProductionLedger(prefix(3), expected)).toEqual({
      baselineLength: 3,
      atBaseline: true,
    });
  });

  it("accepts partial progress after the baseline so a failed migration can be retried", () => {
    expect(assertResumableProductionLedger(prefix(4), expected)).toEqual({
      baselineLength: 3,
      atBaseline: false,
    });
  });

  it("accepts any newer incomplete exact active-chain prefix", () => {
    expect(assertResumableProductionLedger(prefix(5), expected)).toEqual({
      baselineLength: 3,
      atBaseline: false,
    });
  });

  it("accepts an already complete active chain", () => {
    expect(assertResumableProductionLedger(prefix(expected.length), expected)).toEqual({
      baselineLength: 3,
      atBaseline: false,
    });
  });

  it("rejects a ledger older than the confirmed production baseline", () => {
    expect(() => assertResumableProductionLedger(prefix(2), expected)).toThrow(/早于已确认/);
  });

  it("rejects hash or timestamp divergence even after the baseline", () => {
    const divergent = prefix(4);
    divergent[3] = { ...divergent[3], hash: "unexpected" };
    expect(() => assertResumableProductionLedger(divergent, expected)).toThrow(/精确前缀/);
  });

  it("fails closed when the active chain no longer contains the configured baseline tag", () => {
    const missingBaseline = expected.map((migration) => ({
      ...migration,
      tag: migration.tag === PRODUCTION_BASELINE_TAG ? "0024_other" : migration.tag,
    }));
    expect(() => assertResumableProductionLedger(prefix(3), missingBaseline)).toThrow(/缺少已确认/);
  });
});
