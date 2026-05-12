import { describe, expect, it } from "vitest";
import { getRegistrationWindowState } from "@/lib/registration/window";

const now = new Date("2026-05-12T12:00:00.000Z");

describe("getRegistrationWindowState", () => {
  it("allows draft but blocks submit before startAt", () => {
    const state = getRegistrationWindowState({
      status: "registration",
      startAt: "2026-05-13T12:00:00.000Z",
      registrationDeadline: "2026-05-14T12:00:00.000Z",
    }, now);

    expect(state.phase).toBe("upcoming");
    expect(state.canViewForm).toBe(true);
    expect(state.canSaveDraft).toBe(true);
    expect(state.canSubmit).toBe(false);
  });

  it("allows submit after startAt and before deadline", () => {
    const state = getRegistrationWindowState({
      status: "registration",
      startAt: "2026-05-11T12:00:00.000Z",
      registrationDeadline: "2026-05-14T12:00:00.000Z",
    }, now);

    expect(state.phase).toBe("open");
    expect(state.canSubmit).toBe(true);
  });

  it("closes draft and submit at registrationDeadline", () => {
    const state = getRegistrationWindowState({
      status: "registration",
      startAt: "2026-05-11T12:00:00.000Z",
      registrationDeadline: "2026-05-12T12:00:00.000Z",
    }, now);

    expect(state.phase).toBe("closed");
    expect(state.canSaveDraft).toBe(false);
    expect(state.canSubmit).toBe(false);
  });

  it("hides form outside registration status", () => {
    const state = getRegistrationWindowState({
      status: "draft",
      startAt: null,
      registrationDeadline: null,
    }, now);

    expect(state.phase).toBe("hidden");
    expect(state.canViewForm).toBe(false);
  });

  it("opens immediately when startAt is null", () => {
    const state = getRegistrationWindowState({
      status: "registration",
      startAt: null,
      registrationDeadline: "2026-05-14T12:00:00.000Z",
    }, now);

    expect(state.phase).toBe("open");
    expect(state.canSubmit).toBe(true);
  });

  it("never closes when registrationDeadline is null", () => {
    const state = getRegistrationWindowState({
      status: "registration",
      startAt: "2026-05-11T12:00:00.000Z",
      registrationDeadline: null,
    }, now);

    expect(state.phase).toBe("open");
    expect(state.canSubmit).toBe(true);
  });

  it("opens immediately and never closes when both null", () => {
    const state = getRegistrationWindowState({
      status: "registration",
      startAt: null,
      registrationDeadline: null,
    }, now);

    expect(state.phase).toBe("open");
    expect(state.canSaveDraft).toBe(true);
    expect(state.canSubmit).toBe(true);
  });
});
