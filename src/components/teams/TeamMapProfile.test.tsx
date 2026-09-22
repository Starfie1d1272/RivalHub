import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TeamMapProfile } from "./TeamMapProfile";
import { aggregatePublicTeamMapPreviews } from "@/lib/teams/map-profile";

const profile = {
  playedStages: [],
  own: [{ mapName: "de_mirage", wins: 1, played: 3 }],
  experience: [{ mapName: "de_nuke", samples: 20, players: 3, rating: 1.1, adr: 80, kd: 1.2 }],
  preferences: [],
};
describe("team map profile fact priority", () => {
  it("leads with event team results and separates player experience from W/L", () => {
    const html = renderToStaticMarkup(<TeamMapProfile profile={profile} event />);
    expect(html).toContain("1 胜 · 2 负");
    expect(html.indexOf("本届队伍正式表现")).toBeLessThan(html.indexOf("历史正式地图经验"));
    expect(html.indexOf("历史正式地图经验")).toBeLessThan(html.indexOf("成员自报地图熟练度"));
    expect(html).toContain("共 20 次正式地图出场");
    expect(html).not.toContain("地图强度");
    expect(html).not.toContain('open=""');
  });
  it("opens scouting context for a cold-start team without inventing its record", () => {
    const html = renderToStaticMarkup(<TeamMapProfile profile={{ ...profile, own: [] }} />);
    expect(html).toContain("队伍正式历史表现");
    expect(html).toContain('open=""');
    expect(html).not.toContain("胜率");
    expect(html).toContain("尚无自身正式地图样本");
  });
});

describe("team map aggregation", () => {
  it("keeps the same entry-owned W/L facts for directory and detail consumers", () => {
    const result = aggregatePublicTeamMapPreviews(
      ["entry-a", "entry-b"],
      [{ id: "match-1", stage: "playoff", entryAId: "entry-a", entryBId: "entry-b" }],
      [{ matchId: "match-1", mapName: "de_mirage", scoreA: 13, scoreB: 9 }],
    );

    expect(result.get("entry-a")?.own).toEqual([{ mapName: "de_mirage", wins: 1, played: 1 }]);
    expect(result.get("entry-b")?.own).toEqual([{ mapName: "de_mirage", wins: 0, played: 1 }]);
  });
});
