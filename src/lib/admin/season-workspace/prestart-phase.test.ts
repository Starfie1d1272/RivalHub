import { describe, expect, it } from "vitest";
import { deriveMajorPrestartPhase } from "./prestart-phase";

const base = {
  registrationClosed: false,
  approvedCandidateCount: 29,
  pendingReviewCount: 0,
  entrantCapacity: 24,
  entrantCount: 0,
  qualificationConfigured: false,
  qualificationCompleted: false,
  entrantsLocked: false,
  seedsConfirmed: false,
};

describe("Major prestart phase", () => {
  it("advances through qualification, final roster, seed and start", () => {
    expect(deriveMajorPrestartPhase(base)).toBe(1);
    expect(deriveMajorPrestartPhase({ ...base, registrationClosed: true })).toBe(2);
    expect(deriveMajorPrestartPhase({ ...base, registrationClosed: true, qualificationConfigured: true })).toBe(3);
    expect(deriveMajorPrestartPhase({ ...base, registrationClosed: true, qualificationConfigured: true, qualificationCompleted: true })).toBe(4);
    expect(deriveMajorPrestartPhase({ ...base, registrationClosed: true, qualificationConfigured: true, qualificationCompleted: true, entrantsLocked: true })).toBe(5);
    expect(deriveMajorPrestartPhase({ ...base, registrationClosed: true, qualificationConfigured: true, qualificationCompleted: true, entrantsLocked: true, seedsConfirmed: true })).toBe(6);
  });
  it("skips Play-in when the approved set exactly fills the Main Event", () => {
    expect(deriveMajorPrestartPhase({ ...base, registrationClosed: true, approvedCandidateCount: 24 })).toBe(4);
  });
  it("keeps unresolved registration reviews in the first phase", () => {
    expect(deriveMajorPrestartPhase({ ...base, registrationClosed: true, pendingReviewCount: 1 })).toBe(1);
  });
  it("keeps final roster active when a selected entrant requests another review", () => {
    expect(deriveMajorPrestartPhase({ ...base, registrationClosed: true, approvedCandidateCount: 23, pendingReviewCount: 1, qualificationConfigured: true, qualificationCompleted: true, entrantCount: 24 })).toBe(4);
  });
});
