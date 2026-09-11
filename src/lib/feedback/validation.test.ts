import { describe, expect, it } from "vitest";
import { normalizeFeedbackBody, safePublicPathname } from "./validation";

describe("feedback validation", () => {
  it("keeps only a safe pathname projection", () => {
    expect(safePublicPathname("/major-2027/info")).toBe("/major-2027/info");
    expect(safePublicPathname("https://example.com/?token=x")).toBeNull();
    expect(safePublicPathname("/info?query=secret")).toBeNull();
    expect(safePublicPathname("//evil.example/path")).toBeNull();
  });

  it("normalizes user-entered body whitespace", () => {
    expect(normalizeFeedbackBody("  页面  在\n手机上  溢出  ")).toBe("页面 在 手机上 溢出");
  });

  describe("feedback contract and constraints", () => {
    it("safely normalizes feedback body and strips consecutive whitespace", () => {
      expect(normalizeFeedbackBody("  这是    一段测试\n\n反馈内容   ")).toBe("这是 一段测试 反馈内容");
    });

    it("rejects pathnames with protocol, double slash, query params, or hash", () => {
      expect(safePublicPathname("https://malicious.com")).toBe(null);
      expect(safePublicPathname("//malicious.com")).toBe(null);
      expect(safePublicPathname("/2026-spring/matches?param=1")).toBe(null);
      expect(safePublicPathname("/2026-spring#section")).toBe(null);
      expect(safePublicPathname("/2026-spring/matches")).toBe("/2026-spring/matches");
    });
  });
});