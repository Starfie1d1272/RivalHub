import { describe, expect, it } from "vitest";
import { getAdminNavigation } from "./navigation";

describe("admin navigation", () => {
  it("keeps operations but hides feedback from season admins", () => {
    const operations = getAdminNavigation("season_admin").find((group) => group.key === "operations");
    expect(operations?.items.map((item) => item.href)).toEqual([
      "/admin/operations/announcements",
      "/admin/operations/season-info",
    ]);
  });

  it("shows all operations to super admins", () => {
    expect(getAdminNavigation("super_admin").find((group) => group.key === "operations")?.items).toHaveLength(3);
  });
});
