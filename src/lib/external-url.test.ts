import { describe, expect, it } from "vitest";
import { isHttpUrl } from "@/lib/external-url";

describe("external URL safety", () => {
  it("accepts only http and https URLs", () => {
    expect(isHttpUrl("https://video.example/match")).toBe(true);
    expect(isHttpUrl("http://live.example/room")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,unsafe")).toBe(false);
    expect(isHttpUrl("not a URL")).toBe(false);
  });
});
