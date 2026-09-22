import { describe, expect, it } from "vitest";
import type { Route } from "next";
import { StatsLink } from "@/components/stats/StatsLink";

describe("StatsLink", () => {
  it("keeps URL-driven stats navigation at the current scroll position", () => {
    const link = StatsLink({ href: "/season/stats?tab=maps" as Route, children: "地图" });

    expect(link.props).toMatchObject({ href: "/season/stats?tab=maps", scroll: false, children: "地图" });
  });
});
