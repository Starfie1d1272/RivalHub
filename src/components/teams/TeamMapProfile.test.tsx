import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TeamMapProfile } from "./TeamMapProfile";

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
    expect(html).toContain("20 人次地图");
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
