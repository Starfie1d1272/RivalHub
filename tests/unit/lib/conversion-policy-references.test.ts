import { expect, it } from "vitest";
import { groupConversionPolicyEventReferences } from "@/lib/competitive/conversion-policy-admin";
import { normalizeTeamRegistrationConfig } from "@/lib/seasons/compatibility";

it("groups each frozen event once and retains reference ordering, version fallback and lock state", () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({
    id: `event-${i}`, name: `event ${i}`, slug: `event-${i}`, status: "registration" as const,
    registrationOpenedAt: i % 2 ? new Date("2051-01-01") : null,
    teamRegistrationConfig: normalizeTeamRegistrationConfig({ competitiveProfile: {
      platform: "perfect_world", currentSeasonKey: "current", previousSeasonKey: "previous", rankOrder: [],
      conversionPolicyId: `policy-${i % 2}`, conversionPolicyVersion: i % 2 ? "explicit" : undefined,
      fallbackConversion: { sourcePlatform: "fivee", version: "fallback", seasonKeyMap: {}, mapping: { relativeSeasonAlignment: true, belowSRankMap: {}, starSegments: [] } },
    } }),
  }));
  const grouped = groupConversionPolicyEventReferences(rows);
  expect([...grouped.keys()]).toEqual(["policy-0", "policy-1"]);
  expect(grouped.get("policy-0")).toMatchObject([
    { seasonId: "event-0", policyVersion: "fallback", referenceState: "published_locked" },
    { seasonId: "event-2", policyVersion: "fallback", referenceState: "published_locked" },
  ]);
  expect(grouped.get("policy-1")).toMatchObject([
    { seasonId: "event-1", policyVersion: "explicit", referenceState: "registration_frozen" },
  ]);
  expect(groupConversionPolicyEventReferences([{ ...rows[0]!, teamRegistrationConfig: normalizeTeamRegistrationConfig(null) }]).size).toBe(0);
});
