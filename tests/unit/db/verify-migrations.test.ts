import { describe, expect, it, vi } from "vitest";
import { assertCompleteMigrationLedger, assertCurrentTerminalSchema, verifyEducationEvidenceBucket } from "../../../scripts/db/verify-migrations";
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
    expect(() => assertCurrentTerminalSchema({ evidence_code: true, evidence_object_key: true, evidence_url: false, perfect_id: false, roles: ["igl", "awper", "opener", "closer", "anchor"] })).not.toThrow();
    expect(() => assertCurrentTerminalSchema({ evidence_code: false, evidence_object_key: false, evidence_url: true, perfect_id: true, roles: ["igl"] })).toThrow(/terminal schema contract/);
  });

  it("skips Storage verification only when the schema is absent", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ storage_buckets: null }] });

    await expect(verifyEducationEvidenceBucket({ query })).resolves.toBe("skipped");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("checks the private 5 MiB exact MIME bucket contract", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ storage_buckets: "storage.buckets" }] })
      .mockResolvedValueOnce({ rows: [{ public: false, file_size_limit: "5242880", allowed_mime_types: ["image/webp", "image/jpeg", "image/png"] }] });

    await expect(verifyEducationEvidenceBucket({ query })).resolves.toBe("verified");

    const invalidQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ storage_buckets: "storage.buckets" }] })
      .mockResolvedValueOnce({ rows: [{ public: true, file_size_limit: "5242880", allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] }] });
    await expect(verifyEducationEvidenceBucket({ query: invalidQuery })).rejects.toThrow(/education-evidence Storage bucket contract/);
  });
});
