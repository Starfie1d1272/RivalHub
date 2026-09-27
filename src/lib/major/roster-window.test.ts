import { describe, expect, it } from "vitest";
import { isMajorRosterAdjustmentPhaseOpen } from "./roster-window";

const now = new Date("2026-09-15T00:00:00Z");
const closedAt = new Date("2026-09-10T00:00:00Z");

describe("Major self-service roster phase", () => {
  it("closes at candidate freeze and through active Qualification", () => {
    expect(isMajorRosterAdjustmentPhaseOpen({ registrationClosesAt: closedAt, qualificationConfigured: false, qualificationCompleted: false, finalEntrant: false }, now)).toBe(false);
    expect(isMajorRosterAdjustmentPhaseOpen({ registrationClosesAt: closedAt, qualificationConfigured: true, qualificationCompleted: false, finalEntrant: true }, now)).toBe(false);
  });
  it("reopens only for final entrants after Qualification completes", () => {
    expect(isMajorRosterAdjustmentPhaseOpen({ registrationClosesAt: closedAt, qualificationConfigured: true, qualificationCompleted: true, finalEntrant: true }, now)).toBe(true);
    expect(isMajorRosterAdjustmentPhaseOpen({ registrationClosesAt: closedAt, qualificationConfigured: true, qualificationCompleted: true, finalEntrant: false }, now)).toBe(false);
  });
  it("allows a directly filled Main Event after its entrants are selected", () => {
    expect(isMajorRosterAdjustmentPhaseOpen({ registrationClosesAt: closedAt, qualificationConfigured: false, qualificationCompleted: false, finalEntrant: true }, now)).toBe(true);
  });
});
