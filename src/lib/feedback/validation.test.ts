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
});
