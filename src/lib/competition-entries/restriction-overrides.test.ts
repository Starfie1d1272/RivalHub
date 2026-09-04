import { describe, expect, it } from "vitest";
import {
  sameQualificationFindingSnapshot,
  snapshotQualificationFinding,
  unresolvedQualificationFindings,
} from "./restriction-overrides";

const finding = {
  code: "external_strength_gap",
  message: "外校选手高于本校基线超过 3 星。",
  waivable: true,
  metadata: {
    externalStrengthMaxStarGap: 3,
    strongestExternalStars: 39,
    nested: { b: 2, a: 1 },
  },
};

describe("qualification restriction override snapshots", () => {
  it("only resolves the exact typed finding snapshot", () => {
    const snapshot = snapshotQualificationFinding(finding);

    expect(unresolvedQualificationFindings([finding], [])).toEqual([finding]);
    expect(unresolvedQualificationFindings([finding], [{ restrictionCode: finding.code, findingSnapshot: snapshot }])).toEqual([]);
    expect(unresolvedQualificationFindings([
      { ...finding, metadata: { ...finding.metadata, strongestExternalStars: 40 } },
    ], [{ restrictionCode: finding.code, findingSnapshot: snapshot }])).toHaveLength(1);
  });

  it("keeps an override when only the human-readable message changes", () => {
    const snapshot = snapshotQualificationFinding(finding);
    const relabeled = { ...finding, message: "该外校选手超过本届允许的 3 星差值。" };

    expect(sameQualificationFindingSnapshot(snapshot, relabeled)).toBe(true);
    expect(unresolvedQualificationFindings([relabeled], [{ restrictionCode: finding.code, findingSnapshot: snapshot }])).toEqual([]);
    expect(snapshot.message).toBe(finding.message);
  });

  it("ignores presentation and actor identity but rejects changed policy facts or code", () => {
    const labeled = {
      ...finding,
      metadata: {
        ...finding.metadata,
        externalUserId: "external-a",
        homeUserId: "home-c",
        externalLabel: "外校 A",
        homeLabel: "本校 C",
      },
    };
    const snapshot = snapshotQualificationFinding(labeled);

    expect(sameQualificationFindingSnapshot(snapshot, {
      ...labeled,
      message: "更新后的限制说明。",
      metadata: {
        ...labeled.metadata,
        externalUserId: "external-b",
        homeUserId: "home-d",
        externalLabel: "外校 B",
        homeLabel: "本校 D",
      },
    })).toBe(true);
    expect(snapshot.metadata).toMatchObject({ externalUserId: "external-a", homeUserId: "home-c" });
    expect(sameQualificationFindingSnapshot(snapshot, {
      ...labeled,
      metadata: { ...labeled.metadata, strongestExternalStars: 40 },
    })).toBe(false);
    expect(sameQualificationFindingSnapshot(snapshot, { ...labeled, code: "different_restriction" })).toBe(false);
  });

  it("canonicalizes metadata key order without weakening the snapshot", () => {
    const snapshot = snapshotQualificationFinding(finding);
    expect(sameQualificationFindingSnapshot({
      waivable: true,
      message: finding.message,
      metadata: { nested: { a: 1, b: 2 }, strongestExternalStars: 39, externalStrengthMaxStarGap: 3 },
      code: finding.code,
    }, finding)).toBe(true);
    expect(snapshot).toEqual({
      code: finding.code,
      message: finding.message,
      waivable: true,
      metadata: {
        externalStrengthMaxStarGap: 3,
        nested: { a: 1, b: 2 },
        strongestExternalStars: 39,
      },
    });
    expect(snapshot.message).toBe(finding.message);
  });

  it("never treats non-waivable findings as overrideable", () => {
    const missingData = { ...finding, code: "competitive_profile_incomplete", waivable: false };
    expect(unresolvedQualificationFindings([missingData], [{
      restrictionCode: missingData.code,
      findingSnapshot: snapshotQualificationFinding(missingData),
    }])).toEqual([missingData]);
  });
});
