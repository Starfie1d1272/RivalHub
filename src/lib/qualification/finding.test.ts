import { describe, expect, it } from "vitest";
import { uniqueQualificationFindings } from "./finding";

describe("qualification finding identity", () => {
  const finding = {
    code: "external_strength_gap",
    message: "旧版限制说明。",
    waivable: true,
    metadata: { externalUserId: "external-1", strongestExternalStars: 39, strongestHomeStars: 35, externalStrengthMaxStarGap: 3 },
  };

  it("deduplicates the same policy fact even when its message changes", () => {
    const findings = uniqueQualificationFindings([
      finding,
      { ...finding, message: "新版限制说明。" },
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe(finding.message);
  });

  it("keeps semantically different metadata as separate findings", () => {
    expect(uniqueQualificationFindings([
      finding,
      { ...finding, metadata: { ...finding.metadata, strongestExternalStars: 40 } },
    ])).toHaveLength(2);
  });

  it("does not depend on metadata object key order", () => {
    expect(uniqueQualificationFindings([
      finding,
      {
        ...finding,
        metadata: {
          externalStrengthMaxStarGap: 3,
          strongestHomeStars: 35,
          strongestExternalStars: 39,
          externalUserId: "external-1",
        },
      },
    ])).toHaveLength(1);
  });
});
