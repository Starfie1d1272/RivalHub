import { describe, expect, it } from "vitest";
import { getAccountNavigationLinks } from "@/components/layout/HeaderClient";

describe("account navigation", () => {
  it("uses the same task-oriented labels for desktop and mobile account menus", () => {
    expect(getAccountNavigationLinks("user-1", true)).toEqual([
      { href: "/my", label: "我的参赛" },
      { href: "/players/user-1", label: "个人主页" },
      { href: "/settings", label: "账号设置", needsProfile: true },
    ]);
  });
});
