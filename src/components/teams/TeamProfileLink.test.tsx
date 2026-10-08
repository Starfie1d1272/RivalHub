import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TeamProfileLink, teamProfileHref } from "./TeamProfileLink";
import { PlayerProfileLink } from "../players/PlayerProfileLink";
import { SimulationMatchCard } from "../predictions/SimulationMatchCard";
import { MatchCard } from "../matches/MatchCard";
vi.mock("next/navigation", () => ({ useParams: () => ({ seasonSlug: "major" }) }));
vi.mock("./TeamLogo", () => ({ TeamLogo: () => <span/> }));
vi.mock("../matches/MatchStatusBadge", () => ({ MatchStatusBadge: () => <span/> }));
function assertLegal(container: HTMLElement) {
  expect(container.querySelector("a a, button a, a button, button button")).toBeNull();
}
describe("entity profile navigation", () => {
  it("resolves event before long-lived team and encodes route segments", () => {
    expect(teamProfileHref({ seasonSlug: "major", entryId: "a/b", slug: "long" })).toBe("/major/teams/a%2Fb");
    expect(teamProfileHref({ slug: "long team" })).toBe("/teams/long%20team");
    expect(teamProfileHref({ entryId: "orphan" })).toBeNull();
    render(<><TeamProfileLink entryId="entry">Team</TeamProfileLink><PlayerProfileLink userId="u/1">Player</PlayerProfileLink><TeamProfileLink>待定</TeamProfileLink></>);
    expect(screen.getByRole("link", { name: "Team" })).toHaveAttribute("href", "/major/teams/entry");
    expect(screen.getByRole("link", { name: "Player" })).toHaveAttribute("href", "/players/u%2F1");
    expect(screen.queryByRole("link", { name: "待定" })).toBeNull();
  });
  it("isolates mouse and keyboard profile access from surrounding actions", async () => {
    const user = userEvent.setup(), primary = vi.fn(), click = vi.fn();
    render(<div onClick={primary} onKeyDown={primary}><TeamProfileLink entryId="entry" stopPropagation onClick={e => { e.preventDefault(); click(); }}>Team</TeamProfileLink></div>);
    await user.tab(); expect(screen.getByRole("link")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(click).toHaveBeenCalledOnce(); expect(primary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link")); expect(primary).not.toHaveBeenCalled();
  });
  it("simulation match stays reachable when locked and does not choose a winner", async () => {
    const user = userEvent.setup(), choose = vi.fn();
    const { container } = render(<SimulationMatchCard seasonSlug="major" stageKey="stage1" match={{ officialMatchId:"m",key:"m",round:1,record:null,a:"a",b:"b",winner:"a",source:"preview",format:"bo1",scoreA:null,scoreB:null }} teams={new Map([["a", { teamId:"a",name:"Alpha",logoUrl:null,tournamentSeed:1 }]])} seeds={new Map()} busy={false} editable={false} onChoose={choose}/>);
    assertLegal(container);
    const link = screen.getByRole("link", { name: "查看 Alpha 对 队伍 比赛" });
    link.addEventListener("click", e => e.preventDefault());
    await user.click(link); expect(choose).not.toHaveBeenCalled();
    expect(link).toHaveAttribute("href", "/major/matches/m");
  });
  it("match navigation and both team destinations remain independent", () => {
    const { container } = render(<MatchCard matchId="m" seasonSlug="major" entryAId="a" entryBId="b" teamAName="Alpha" teamBName="Beta" scoreA={13} scoreB={9} stageLabel="Final" format="bo1" status="finished"/>);
    assertLegal(container);
    expect(screen.getByRole("link", { name: "Alpha" })).toHaveAttribute("href", "/major/teams/a");
    expect(screen.getByRole("link", { name: "Beta" })).toHaveAttribute("href", "/major/teams/b");
    expect(screen.getByRole("link", { name: "查看 Alpha 对 Beta 比赛" })).toHaveAttribute("href", "/major/matches/m");
  });
});
