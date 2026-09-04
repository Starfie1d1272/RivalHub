import { describe, expect, it } from "vitest";
import { sameQualificationFindingFact, uniqueQualificationFindings } from "./finding";

describe("qualification finding identity", () => {
  const finding = {
    code: "external_strength_gap",
    message: "旧版限制说明。",
    waivable: true,
    metadata: {
      externalUserId: "external-a",
      homeUserId: "home-c",
      externalLabel: "外校 A",
      homeLabel: "本校 C",
      strongestExternalStars: 39,
      strongestHomeStars: 35,
      externalStrengthMaxStarGap: 3,
    },
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
    for (const change of [
      { strongestExternalStars: 40 },
      { strongestHomeStars: 36 },
      { externalStrengthMaxStarGap: 4 },
    ]) {
      expect(uniqueQualificationFindings([
        finding,
        { ...finding, metadata: { ...finding.metadata, ...change } },
      ])).toHaveLength(2);
    }
  });

  it("ignores tied strongest actor selection in the canonical fact", () => {
    const refreshed = {
      ...finding,
      message: "同一 39 vs 35 政策事实的新文案。",
      metadata: {
        ...finding.metadata,
        externalUserId: "external-b",
        homeUserId: "home-d",
        externalLabel: "外校 B",
        homeLabel: "本校 D",
      },
    };

    expect(sameQualificationFindingFact(finding, refreshed)).toBe(true);
    expect(uniqueQualificationFindings([finding, refreshed])).toHaveLength(1);
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
          externalUserId: "external-b",
          homeUserId: "home-d",
        },
      },
    ])).toHaveLength(1);
  });
});
