import { describe, expect, it } from "vitest";
import { getAdminNavigation, getActiveAdminNavigationHref } from "./navigation";

describe("admin navigation", () => {
  it("keeps operations but hides feedback from season admins", () => {
    const operations = getAdminNavigation("season_admin").find((group) => group.key === "operations");
    expect(operations?.items.map((item) => item.href)).toEqual(expect.arrayContaining([
      "/admin/operations",
      "/admin/operations/announcements",
      "/admin/operations/season-info",
    ]));
    expect(operations?.items.some((item) => item.href === "/admin/operations/feedback")).toBe(false);
  });

  it("shows all operations to super admins", () => {
    expect(getAdminNavigation("super_admin").find((group) => group.key === "operations")?.items.map(item => item.href)).toContain("/admin/operations/feedback");
  });
});


describe("active admin destination", () => {
  it.each([
    ["/admin", "/admin"],
    ["/admin/competitive-seasons", "/admin/competitive-seasons"],
    ["/admin/competitive-seasons/conversion-policies", "/admin/competitive-seasons/conversion-policies"],
    ["/admin/competitive-seasons/conversion-policies/123", "/admin/competitive-seasons/conversion-policies"],
    ["/admin/competitive-seasons-other", null],
  ])("selects the most specific visible route at %s", (path, expected) => {
    expect(getActiveAdminNavigationHref(path, getAdminNavigation("super_admin"))).toBe(expected);
  });
});
