import { describe, expect, it } from "vitest";
import {
  TRANSITION_RULES,
  validateTransition,
} from "@/lib/registration-transitions";
import { AppError, ErrorCode } from "@/lib/errors";

describe("TRANSITION_RULES", () => {
  it("pending→approved 允许 registration 和 voting 状态", () => {
    const rule = TRANSITION_RULES["pending→approved"];
    expect(rule).toBeDefined();
    expect(rule!.allowedSeasonStatuses).toEqual(["registration", "voting"]);
  });

  it("pending→rejected 允许任意赛季阶段", () => {
    const rule = TRANSITION_RULES["pending→rejected"];
    expect(rule).toBeDefined();
    expect(rule!.allowedSeasonStatuses).toEqual([]);
  });

  it("pending→waitlisted 仅允许 registration", () => {
    const rule = TRANSITION_RULES["pending→waitlisted"];
    expect(rule).toBeDefined();
    expect(rule!.allowedSeasonStatuses).toEqual(["registration"]);
  });

  it("waitlisted→approved 允许 registration 和 voting", () => {
    const rule = TRANSITION_RULES["waitlisted→approved"];
    expect(rule).toBeDefined();
    expect(rule!.allowedSeasonStatuses).toEqual(["registration", "voting"]);
  });

  it("approved→rejected 仅允许 registration", () => {
    const rule = TRANSITION_RULES["approved→rejected"];
    expect(rule).toBeDefined();
    expect(rule!.allowedSeasonStatuses).toEqual(["registration"]);
  });

  it("rejected→approved 仅允许 registration", () => {
    const rule = TRANSITION_RULES["rejected→approved"];
    expect(rule).toBeDefined();
    expect(rule!.allowedSeasonStatuses).toEqual(["registration"]);
  });

  it("不允许 finished→approved 这样的非法迁移", () => {
    // finished 不是合法的 RegistrationStatus，所以 TRANSITION_RULES 中没有此项
    expect("finished→approved" in TRANSITION_RULES).toBe(false);
  });
});

describe("validateTransition", () => {
  it("合法的 pending→approved 在 registration 赛季阶段不抛错", () => {
    expect(() =>
      validateTransition("pending", "approved", "registration")
    ).not.toThrow();
  });

  it("合法的 pending→rejected 在任何赛季阶段不抛错", () => {
    expect(() =>
      validateTransition("pending", "rejected", "archived")
    ).not.toThrow();
  });

  it("pending→approved 在 playing 赛季阶段抛错", () => {
    expect(() =>
      validateTransition("pending", "approved", "playing")
    ).toThrow(AppError);
    try {
      validateTransition("pending", "approved", "playing");
    } catch (e) {
      expect(e instanceof AppError).toBe(true);
      expect((e as AppError).code).toBe(ErrorCode.SEASON_INVALID_STATUS);
    }
  });

  it("非法迁移 pending→finished 抛错（状态机未定义）", () => {
    try {
      // @ts-expect-error - 测试非法状态
      validateTransition("pending", "finished", "registration");
    } catch (e) {
      expect(e instanceof AppError).toBe(true);
      expect((e as AppError).code).toBe(ErrorCode.REGISTRATION_INVALID_TRANSITION);
    }
  });

  it("waitlisted→approved 仅在 registration/voting 可用", () => {
    expect(() =>
      validateTransition("waitlisted", "approved", "registration")
    ).not.toThrow();
    expect(() =>
      validateTransition("waitlisted", "approved", "voting")
    ).not.toThrow();
    expect(() =>
      validateTransition("waitlisted", "approved", "playing")
    ).toThrow(AppError);
  });

  it("waitlisted→rejected 允许任意赛季阶段", () => {
    expect(() =>
      validateTransition("waitlisted", "rejected", "finished")
    ).not.toThrow();
  });
});
