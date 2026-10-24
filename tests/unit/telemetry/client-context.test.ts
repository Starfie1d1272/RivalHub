import { expect, it } from "vitest";
import { classifyClient } from "@/lib/telemetry/client-context";

it("projects mobile, tablet and browser families without returning identifying inputs", () => {
  expect(classifyClient("Mozilla iPhone Mac OS X Safari/1", 5, "", "https://site.invalid")).toEqual({ device: "mobile", os: "ios", browser: "safari", source: "none" });
  expect(classifyClient("Mozilla Macintosh Safari/1", 5, "", "https://site.invalid")).toMatchObject({ device: "tablet", os: "ios" });
  expect(classifyClient("Mozilla Android Chrome/1", 5, "", "https://site.invalid")).toMatchObject({ device: "tablet", os: "android", browser: "chrome" });
  expect(classifyClient("Mozilla Windows Chrome/1 Edg/1", 0, "", "https://site.invalid")).toMatchObject({ device: "desktop", os: "windows", browser: "edge" });
  expect(classifyClient("", 0, "", "https://site.invalid")).toMatchObject({ device: "unknown", browser: "other" });
});

it("keeps only document source category and drops credentials, path, query and host", () => {
  for (const [referrer, source] of [["https://site.invalid/private?token=SECRET", "internal"], ["https://www.baidu.com/s?wd=SECRET", "search"], ["https://m.bilibili.com/PRIVATE", "social"], ["https://baidu.com.attacker.invalid/SECRET", "external"], ["https://PRIVATE:SECRET@private.invalid/PRIVATE?q=SECRET", "external"], ["javascript:PRIVATE", "unknown"], ["PRIVATE", "unknown"]]) {
    const result = classifyClient("PRIVATE", 0, referrer, "https://site.invalid");
    expect(result.source).toBe(source);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|SECRET|invalid|baidu/);
  }
});
