import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as contract from "@/lib/demo-evidence/contract";
import { ErrorCode } from "@/lib/errors";
import { parseStoredEvidence } from "@/lib/demo-integration/revalidation";
import { readStoredEvidence } from "@/lib/demo-integration/review";
import { submitRivalHubEvidence } from "@/lib/demo-integration/submit";

vi.mock("@/db/client", () => ({ db: {} }));
afterEach(() => vi.restoreAllMocks());

const row = { payload: {} } as Parameters<typeof readStoredEvidence>[0];
const submit = (input: unknown) => submitRivalHubEvidence({
  input, pairingId: "fixture-pairing", pairingScope: { seasonIds: [] },
});

describe("Demo parser failure boundary", () => {
  // A coding failure must not become an invalid-artifact issue or expose its
  // message as an expected validation response. The existing happy PG path
  // cannot exercise an unexpected exception inside the pure contract parser.
  it.each(["submission", "stored recheck", "identity review"] as const)(
    "preserves an unexpected parser cause in %s",
    async (operation) => {
      const cause = new TypeError("synthetic parser defect token=private");
      vi.spyOn(contract, "parseRivalHubDemoEvidenceV1").mockImplementation(() => { throw cause; });
      const invoke = async () => operation === "submission" ? submit({})
        : operation === "stored recheck" ? parseStoredEvidence(row) : readStoredEvidence(row);
      await expect(invoke()).rejects.toBe(cause);
    },
  );

  it("keeps malformed wire data on the existing validation paths", async () => {
    expect(parseStoredEvidence(row)).toMatchObject({ evidence: null, issues: [{ code: "STORED_PAYLOAD_INVALID" }] });
    expect(() => readStoredEvidence(row)).toThrow(expect.objectContaining({ code: ErrorCode.VALIDATION_FAILED }));
    await expect(submit({})).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it("keeps semantic relationship failures as expected invalid evidence", async () => {
    const evidence = JSON.parse(readFileSync("tests/fixtures/demo-evidence/normal-map-v1.json", "utf8"));
    evidence.source.mapName = "de_invalid_fixture";
    const stored = { ...row, payload: evidence };
    expect(parseStoredEvidence(stored)).toMatchObject({ evidence: null, issues: [{ code: "STORED_PAYLOAD_INVALID" }] });
    expect(() => readStoredEvidence(stored)).toThrow(expect.objectContaining({ code: ErrorCode.VALIDATION_FAILED }));
    await expect(submit(evidence)).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});
