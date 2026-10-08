import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatCST,
  getCountdownSeconds,
  isDeadlinePassed,
  formatCSTDateTime,
  formatCSTDate,
  formatCSTShortDate,
  parseCSTInput,
  toCSTDateTimeInput,
} from "@/lib/utils/date";

describe("deadline boundaries", () => {
  const now = new Date("2026-06-01T17:30:00.000Z");
  afterEach(() => vi.useRealTimers());

  it.each([-1000, 0, 999, 1000, 60000])("uses exact remaining seconds and an inclusive deadline at %i ms", (offset) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const deadline = new Date(now.getTime() + offset);
    for (const value of [deadline, deadline.toISOString()]) {
      expect(getCountdownSeconds(value)).toBe(Math.max(0, Math.floor(offset / 1000)));
      expect(isDeadlinePassed(value)).toBe(offset <= 0);
    }
  });
});

describe("CST formatters", () => {
  it.each(["2026-06-01T17:30:00.000Z", new Date("2026-06-01T17:30:00.000Z")])("uses Asia/Shanghai across the UTC date boundary for %s", (value) => {
    expect(formatCST(value)).toContain("2026/06/02 01:30");
    expect(formatCSTDate(value)).toBe("2026/06/02");
    expect(formatCSTShortDate(value)).toMatch(/6月2日/);
    expect(formatCSTDateTime(value)).toMatch(/6月2日.*01:30/);
  });
});

describe("parseCSTInput", () => {
  it("含 +08:00 偏移的 datetime-local 值解析为 Date", () => {
    const d = parseCSTInput("2026-06-01T14:00");
    expect(d?.toISOString()).toBe("2026-06-01T06:00:00.000Z");
  });

  it("null 返回 null", () => {
    expect(parseCSTInput(null)).toBeNull();
  });
});

describe("toCSTDateTimeInput", () => {
  it("UTC Date 转为 CST datetime-local 字符串", () => {
    const d = new Date("2026-06-01T06:00:00.000Z");
    const result = toCSTDateTimeInput(d);
    expect(result).toMatch(/2026-06-01T14:00/);
  });

  it("null 返回 null", () => {
    expect(toCSTDateTimeInput(null)).toBeNull();
  });
});
