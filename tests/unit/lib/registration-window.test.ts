import { describe, expect, it } from "vitest";
import { canSelfChangeApprovedRoster, getRegistrationWindowState } from "@/lib/registration/window";

const now = new Date("2026-05-12T12:00:00.000Z");

describe("getRegistrationWindowState", () => {
  it("blocks submit before the scheduled registration opening", () => {
    const state = getRegistrationWindowState({
      status: "registration",
      registrationOpensAt: "2026-05-13T12:00:00.000Z",
      registrationOpenedAt: null,
      registrationClosesAt: "2026-05-14T12:00:00.000Z",
    }, now);

    expect(state.phase).toBe("upcoming");
    expect(state.canViewForm).toBe(true);
    expect(state.canSaveDraft).toBe(false);
    expect(state.canSubmit).toBe(false);
  });

  it("allows submit after startAt and before deadline", () => {
    const state = getRegistrationWindowState({
      status: "registration",
      registrationOpensAt: "2026-05-11T12:00:00.000Z",
      registrationOpenedAt: "2026-05-11T12:00:00.000Z",
      registrationClosesAt: "2026-05-14T12:00:00.000Z",
    }, now);

    expect(state.phase).toBe("open");
    expect(state.canSubmit).toBe(true);
  });

  it("closes draft and submit at registrationDeadline", () => {
    const state = getRegistrationWindowState({
      status: "registration",
      registrationOpensAt: "2026-05-11T12:00:00.000Z",
      registrationOpenedAt: "2026-05-11T12:00:00.000Z",
      registrationClosesAt: "2026-05-12T12:00:00.000Z",
    }, now);

    expect(state.phase).toBe("closed");
    expect(state.canSaveDraft).toBe(false);
    expect(state.canSubmit).toBe(false);
  });

  it("hides form outside registration status", () => {
    const state = getRegistrationWindowState({
      status: "draft",
      registrationOpensAt: null,
      registrationClosesAt: null,
    }, now);

    expect(state.phase).toBe("hidden");
    expect(state.canViewForm).toBe(false);
  });

  it("keeps a published event unscheduled when registrationOpensAt is null", () => {
    const state = getRegistrationWindowState({
      status: "registration",
      registrationOpensAt: null,
      registrationClosesAt: "2026-05-14T12:00:00.000Z",
    }, now);

    expect(state.phase).toBe("unscheduled");
    expect(state.canSubmit).toBe(false);
  });

  it("never closes when registrationClosesAt is null", () => {
    const state = getRegistrationWindowState({
      status: "registration",
      registrationOpensAt: "2026-05-11T12:00:00.000Z",
      registrationOpenedAt: "2026-05-11T12:00:00.000Z",
      registrationClosesAt: null,
    }, now);

    expect(state.phase).toBe("open");
    expect(state.canSubmit).toBe(true);
  });

  it("waits for the canonical opening transition after its scheduled time", () => {
    const state = getRegistrationWindowState({
      status: "registration",
      registrationOpensAt: "2026-05-11T12:00:00.000Z",
      registrationOpenedAt: null,
      registrationClosesAt: null,
    }, now);

    expect(state.phase).toBe("upcoming");
    expect(state.canSubmit).toBe(false);
  });
});

describe("canSelfChangeApprovedRoster", () => {
  it("refuses an approved roster change before the actual registration transition", () => {
    expect(canSelfChangeApprovedRoster({
      status: "registration",
      registrationOpensAt: "2026-05-11T12:00:00.000Z",
      registrationOpenedAt: null,
      registrationClosesAt: "2026-05-14T12:00:00.000Z",
      rosterChangeClosesAt: "2026-05-16T12:00:00.000Z",
    }, now)).toBe(false);
  });

  it("allows an approved roster change after the actual transition until its own deadline", () => {
    expect(canSelfChangeApprovedRoster({
      status: "registration",
      registrationOpensAt: "2026-05-11T12:00:00.000Z",
      registrationOpenedAt: "2026-05-11T12:00:01.000Z",
      registrationClosesAt: "2026-05-12T11:00:00.000Z",
      rosterChangeClosesAt: "2026-05-16T12:00:00.000Z",
    }, now)).toBe(true);
  });
});
