import { describe, expect, it } from "vitest";
import { validateTransition, type RegistrationStatus } from "./registration-transitions";
import { AppError, ErrorCode } from "./errors";

// Registration review policy is verified through the executable boundary;
// changing the representation of its lookup table must not break this suite.
const allowed = [
  ["pending", "approved", ["registration", "voting"]],
  ["pending", "rejected", null],
  ["pending", "waitlisted", ["registration"]],
  ["waitlisted", "approved", ["registration", "voting"]],
  ["waitlisted", "rejected", null],
  ["approved", "pending", ["registration"]],
  ["approved", "rejected", ["registration", "voting"]],
  ["rejected", "approved", ["registration"]],
  ["rejected", "pending", ["registration"]],
] as const;
const phases = ["draft", "registration", "voting", "drafting", "playing", "finished", "archived"];

describe("registration review transitions", () => {
  it.each(allowed)("enforces phase policy for %s → %s", (current, target, allowedPhases) => {
    for (const phase of phases) {
      const transition = () => validateTransition(current, target, phase);
      if (allowedPhases === null || (allowedPhases as readonly string[]).includes(phase)) {
        expect(transition, phase).not.toThrow();
      } else {
        expect(transition, phase).toThrow(expect.objectContaining({ code: ErrorCode.SEASON_INVALID_STATUS }));
      }
    }
  });

  it("rejects every undefined review transition even during registration", () => {
    const statuses: RegistrationStatus[] = ["pending", "approved", "rejected", "waitlisted"];
    for (const current of statuses) for (const target of statuses) {
      if (allowed.some(([from, to]) => from === current && to === target)) continue;
      expect(() => validateTransition(current, target, "registration")).toThrow(
        expect.objectContaining({ code: ErrorCode.REGISTRATION_INVALID_TRANSITION }),
      );
    }
    // Invalid runtime input must throw; a try/catch-only assertion can pass silently.
    // @ts-expect-error - exercise an invalid runtime status
    expect(() => validateTransition("pending", "finished", "registration")).toThrow(AppError);
  });
});
