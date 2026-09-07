import { describe, expect, it } from "vitest";
import { presentRegistrationSchedule } from "@/lib/seasons/presentation";

const now = new Date("2026-09-08T00:00:00.000Z");

describe("presentRegistrationSchedule", () => {
  it("keeps absolute schedule facts visible across every registration phase", () => {
    expect(presentRegistrationSchedule({
      status: "registration",
      registrationOpensAt: null,
      registrationClosesAt: null,
    }, now)).toMatchObject({ primary: "报名开放时间待定", countdownTarget: null });

    expect(presentRegistrationSchedule({
      status: "registration",
      registrationOpensAt: "2026-09-10T12:00:00.000Z",
      registrationOpenedAt: null,
      registrationClosesAt: "2026-09-17T15:59:00.000Z",
    }, now)).toMatchObject({
      primary: "9月10日 20:00 开放报名",
      secondary: "9月17日 23:59 截止",
      countdownTarget: "2026-09-10T12:00:00.000Z",
    });

    expect(presentRegistrationSchedule({
      status: "registration",
      registrationOpensAt: "2026-09-07T12:00:00.000Z",
      registrationOpenedAt: "2026-09-07T12:01:00.000Z",
      registrationClosesAt: "2026-09-17T15:59:00.000Z",
    }, now)).toMatchObject({ primary: "9月17日 23:59 截止" });

    expect(presentRegistrationSchedule({
      status: "registration",
      registrationOpensAt: "2026-09-01T12:00:00.000Z",
      registrationOpenedAt: "2026-09-01T12:01:00.000Z",
      registrationClosesAt: "2026-09-07T15:59:00.000Z",
    }, now)).toMatchObject({ primary: "报名已于 9月7日 23:59 截止", countdownTarget: null });
  });
});
