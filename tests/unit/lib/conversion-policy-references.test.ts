import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { groupConversionPolicyEventReferences } from "@/lib/competitive/conversion-policy-admin";
import { normalizeTeamRegistrationConfig } from "@/lib/seasons/compatibility";

it("groups each frozen event once and retains reference ordering, version fallback and lock state", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    id: `event-${i}`, name: `event ${i}`, slug: `event-${i}`, status: "registration" as const,
    registrationOpenedAt: i % 2 ? new Date("2051-01-01") : null,
    teamRegistrationConfig: normalizeTeamRegistrationConfig({ competitiveProfile: {
      platform: "perfect_world", currentSeasonKey: "current", previousSeasonKey: "previous", rankOrder: [],
      conversionPolicyId: `policy-${i % 100}`, conversionPolicyVersion: i % 2 ? "explicit" : undefined,
      fallbackConversion: { sourcePlatform: "fivee", version: "fallback", seasonKeyMap: {}, mapping: { relativeSeasonAlignment: true, belowSRankMap: {}, starSegments: [] } },
    } }),
  }));
  // Previous per-policy scan, retained only as a benchmark and semantic oracle.
  const start = performance.now();
  const before = new Map(Array.from({ length: 100 }, (_, p) => [`policy-${p}`, rows.flatMap(season => {
    const profile = normalizeTeamRegistrationConfig(season.teamRegistrationConfig).competitiveProfile;
    return profile?.conversionPolicyId === `policy-${p}` ? [{ seasonId: season.id, seasonName: season.name, seasonSlug: season.slug,
      seasonStatus: season.status, policyId: profile.conversionPolicyId, policyVersion: profile.conversionPolicyVersion ?? profile.fallbackConversion?.version ?? null,
      registrationOpenedAt: season.registrationOpenedAt, referenceState: season.registrationOpenedAt ? "registration_frozen" : "published_locked" }] : [];
  })]));
  const baselineMs = performance.now() - start;
  const afterStart = performance.now();
  const after = groupConversionPolicyEventReferences(rows);
  const candidateMs = performance.now() - afterStart;
  expect(after).toEqual(before);
  expect(groupConversionPolicyEventReferences([{ ...rows[0]!, teamRegistrationConfig: normalizeTeamRegistrationConfig(null) }]).size).toBe(0);
  console.info("ADMIN_POLICY_REFERENCES_COST", JSON.stringify({ policies: 100, events: 1000, baselineNormalizations: 100000, candidateNormalizations: 1000, baselineMs, candidateMs }));
});
