import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SeasonPostEventOverview } from "@/components/admin/SeasonPostEventOverview";
import type { PostEventPageData } from "@/lib/admin/season-workspace/types";

const data: PostEventPageData = {
  season: { id: "season-1", name: "Rivals S1", status: "archived", competitionTemplate: "rivals" },
  data: {
    seasonId: "season-1",
    seasonStatus: "archived",
    competitionTemplate: "rivals",
    matchCount: 12,
    honorCount: 2,
    activeAdjudicationCount: 1,
    finalResult: null,
    teams: [],
    honors: [],
    adjudications: [],
  },
};

describe("SeasonPostEventOverview", () => {
  it("renders a generic closure summary without Major final-result claims", () => {
    const html = renderToStaticMarkup(<SeasonPostEventOverview data={data} />);

    expect(html).toContain("Rivals S1");
    expect(html).toContain("赛后摘要");
    expect(html).toContain(">12<");
    expect(html).toContain(">2<");
    expect(html).toContain(">1<");
    expect(html).not.toContain("官方最终结果确认");
  });
});
