import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const { steps } = vi.hoisted(() => ({ steps: [
  { id: "1", stepOrder: 1, actionType: "ban", entryId: "a", mapName: "de_inferno", side: null },
  { id: "2", stepOrder: 2, actionType: "pick", entryId: "a", mapName: "de_nuke", side: "ct" },
  { id: "3", stepOrder: 3, actionType: "decider", entryId: "b", mapName: "de_dust2", side: "t" },
  { id: "4", stepOrder: 4, actionType: "side_pick", entryId: "b", mapName: "de_nuke", side: "ct" },
] }));
vi.mock("@/db/client", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => steps }) }) }) } }));
import { VetoView } from "./VetoView";
describe("BP language", () => {
  it("keeps action badges, HLTV-style sentences and correct side ownership", async () => {
    const html = renderToStaticMarkup(await VetoView({ matchId: "match", seasonSlug: "major", teamAName: "Þór", teamBName: "DUSTY", entryAId: "a", entryBId: "b" }));
    const node = document.createElement("div"); node.innerHTML = html;
    const rows = [...node.querySelectorAll("li")].map(row => row.textContent!.replace(/\s+/g, " "));
    expect(rows[0]).toContain("BANÞór removed Inferno");
    expect(rows[1]).toContain("PICKÞór picked Nuke");
    expect(rows[1]).toContain("DUSTY · CT");
    expect(rows[2]).toContain("DECIDERDust2 was left over");
    expect(rows[2]).not.toContain("DUSTY picked");
    expect(rows[3]).toContain("SIDEDUSTY chose CT on Nuke");
    expect(html).not.toContain("成为决胜图");
    expect(node.querySelectorAll('a[href="/major/teams/a"]').length).toBeGreaterThan(0);
    expect(node.querySelectorAll('a[href="/major/teams/b"]').length).toBeGreaterThan(0);
    expect(node.querySelector("a a, button a, a button")).toBeNull();
  });
});
