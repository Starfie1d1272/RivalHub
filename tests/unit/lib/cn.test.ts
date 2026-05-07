import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils/cn";

describe("cn()", () => {
  it("合并普通 class 字符串", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("Tailwind 冲突类以最后一个为准", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("忽略 falsy 值", () => {
    expect(cn("foo", false, undefined, null, "bar")).toBe("foo bar");
  });
});
