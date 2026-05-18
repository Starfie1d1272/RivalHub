import { describe, expect, it } from "vitest";
import {
  formatCST,
  parseCST,
  getCountdownSeconds,
  isDeadlinePassed,
  formatCSTDateTime,
  formatCSTShortDate,
  parseCSTInput,
  toCSTDateTimeInput,
} from "@/lib/utils/date";

describe("formatCST", () => {
  it("Date 对象返回中国时间字符串", () => {
    // 2026-06-01T06:00:00.000Z = 北京时间 14:00
    const d = new Date("2026-06-01T06:00:00.000Z");
    const result = formatCST(d);
    expect(result).toContain("14:00");
    expect(result).toContain("2026");
  });

  it("字符串输入也可处理", () => {
    const result = formatCST("2026-06-01T06:00:00.000Z");
    expect(result).toContain("14:00");
  });
});

describe("parseCST", () => {
  it("返回 Date 对象", () => {
    const d = parseCST("2026-06-01T06:00:00.000Z");
    expect(d instanceof Date).toBe(true);
    expect(d.toISOString()).toBe("2026-06-01T06:00:00.000Z");
  });
});

describe("getCountdownSeconds", () => {
  it("未来时间返回正数", () => {
    const future = new Date(Date.now() + 60_000); // 1 分钟后
    const secs = getCountdownSeconds(future);
    expect(secs).toBeGreaterThan(0);
    expect(secs).toBeLessThanOrEqual(60);
  });

  it("过去时间返回 0", () => {
    const past = new Date(Date.now() - 60_000);
    expect(getCountdownSeconds(past)).toBe(0);
  });

  it("字符串输入也可处理", () => {
    const future = new Date(Date.now() + 120_000).toISOString();
    const secs = getCountdownSeconds(future);
    expect(secs).toBeGreaterThan(0);
  });
});

describe("isDeadlinePassed", () => {
  it("过去时间返回 true", () => {
    expect(isDeadlinePassed(new Date(Date.now() - 1_000))).toBe(true);
  });

  it("未来时间返回 false", () => {
    expect(isDeadlinePassed(new Date(Date.now() + 60_000))).toBe(false);
  });

  it("字符串输入也可处理", () => {
    expect(isDeadlinePassed(new Date(Date.now() - 10_000).toISOString())).toBe(
      true
    );
  });
});

describe("formatCSTDateTime", () => {
  it("返回 CST 月日+时间格式", () => {
    // 2026-06-01T06:00:00.000Z = 北京时间 14:00
    const d = new Date("2026-06-01T06:00:00.000Z");
    const result = formatCSTDateTime(d);
    expect(result).toContain("14:00");
    expect(result).toMatch(/6月1日/);
  });

  it("字符串输入也可处理", () => {
    const result = formatCSTDateTime("2026-12-15T10:30:00.000Z");
    expect(result).toContain("18:30");
    expect(result).toMatch(/12月15日/);
  });
});

describe("formatCSTShortDate", () => {
  it("返回 CST 月日格式", () => {
    const d = new Date("2026-06-01T06:00:00.000Z");
    const result = formatCSTShortDate(d);
    expect(result).toMatch(/6月1日/);
  });
});

describe("parseCSTInput", () => {
  it("含 +08:00 偏移的 datetime-local 值解析为 Date", () => {
    const d = parseCSTInput("2026-06-01T14:00");
    expect(d instanceof Date).toBe(true);
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
