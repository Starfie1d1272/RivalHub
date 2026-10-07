import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MajorRankingWorkspace, type RankingTeam } from "@/components/admin/MajorRankingWorkspace";
vi.mock("next/navigation", () => ({ useParams: () => ({ seasonSlug: "major" }) }));
Object.assign(globalThis, { React });
const fact = { rank: "黄金S", stars: 17, rating:1.14, sourcePlatform:"perfect_world",sourceSeasonKey:"s18",sourceRank:"黄金S",sourceStars:17,conversionVersion:null };
const teams: RankingTeam[] = ["first", "second"].map((entryId,index) => ({ entryId,teamName:entryId,systemRank:index+1,tieState:"not_tied",members:Array.from({length:7},(_,slot)=>({userId:`${entryId}-${slot}`,label:`选手${entryId}${slot}`,isPrimaryStarter:slot<5,presentation:{compositeRank:{rank:"黄金S",stars:18},historicalPeak:fact,referenceSeasonPeak:fact,currentSeasonPeak:fact,recentPeak:fact,historicalRating:1.14,available:true,blockers:[]}})) }));
beforeEach(() => { localStorage.clear(); vi.stubGlobal("matchMedia", vi.fn(() => ({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}))); });
describe("Ranking Workspace",()=>{
  it("offers profile links without selecting evidence or changing ranking", async () => {
    const user = userEvent.setup(), onOrderChange = vi.fn();
    const { container } = render(<MajorRankingWorkspace mode="preliminary" teams={teams} order={["first", "second"]} platform="perfect_world" onOrderChange={onOrderChange}/>);
    const profile = screen.getByRole("link", { name: "查看 选手first0 选手资料" });
    profile.addEventListener("click", event => event.preventDefault());
    await user.click(profile);
    expect(profile).toHaveAttribute("href", "/players/first-0");
    expect(screen.getByRole("button", { name: "选手first0，主力，查看实力证据" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("link", { name: "first" })).toHaveAttribute("href", "/major/teams/first");
    expect(onOrderChange).not.toHaveBeenCalled();
    expect(container.querySelector("button a, a a, a button")).toBeNull();
  });
  it("shows representative S stars with the explicit unranked estimate label", async () => {
    const user = userEvent.setup(), estimated = structuredClone(teams);
    estimated[0]!.members[0]!.presentation.referenceSeasonPeak = { ...fact, stars: 24, estimatedFromUnranked: true, estimatedFromHistorical: true };
    render(<MajorRankingWorkspace mode="preliminary" teams={estimated} order={["first","second"]} platform="perfect_world" />);
    await user.click(screen.getByRole("button", { name: "选手first0，主力，查看实力证据" }));
    expect(within(screen.getByRole("complementary")).getByText(/参考赛季 P.*未定级.*黄金S.*24/)).toBeInTheDocument();
  });
  it("defaults to 100% and permits overview steps down to 50% without changing order", async () => {
    const user = userEvent.setup(), onOrderChange = vi.fn();
    render(<MajorRankingWorkspace mode="preliminary" teams={teams} order={["first","second"]} platform="perfect_world" onOrderChange={onOrderChange} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
    const smaller = screen.getByRole("button", { name: "缩小矩阵" });
    for (const percent of [90, 75, 60, 50]) { await user.click(smaller); expect(screen.getByText(`${percent}%`)).toBeInTheDocument(); }
    expect(smaller).toBeDisabled();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(onOrderChange).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("rivalhub-major-ranking-preferences")!)).toEqual({ zoom: 50 });
    await user.click(screen.getByRole("button", { name: "放大矩阵" }));
    expect(screen.getByText("60%")).toBeInTheDocument();
  });
  it("uses five starter columns and nickname/composite only, with non-modal continuous inspection",async()=>{
    const user=userEvent.setup();render(<MajorRankingWorkspace mode="preliminary" teams={teams} order={["first","second"]} platform="perfect_world" />);
    for(let i=1;i<=5;i++)expect(screen.getByRole("columnheader",{name:`主力${i}`})).toBeInTheDocument();
    expect(screen.getByRole("columnheader",{name:"替补"})).toBeInTheDocument();
    const player=screen.getByRole("button",{name:"选手first0，主力，查看实力证据"});
    expect(player).toHaveTextContent("金18");expect(player).not.toHaveTextContent("R1.14");
    await user.click(player);expect(player).toHaveAttribute("aria-pressed","true");
    const inspector=screen.getByRole("complementary",{name:"选手实力证据"});
    expect(within(inspector).getByText(/历史最高 H.*Rating 1.14/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button",{name:"选手second6，替补，查看实力证据"}));
    expect(inspector).toHaveTextContent("选手second6");
    await user.click(screen.getByRole("button",{name:"关闭选手证据"}));expect(screen.queryByRole("complementary")).toBeNull();
  });
  it("keeps precision move-to behind rank, keyboard arrows and true tie semantics",async()=>{
    const user=userEvent.setup(), onOrderChange=vi.fn();render(<MajorRankingWorkspace mode="preliminary" teams={teams} order={["first","second"]} platform="perfect_world" onOrderChange={onOrderChange} />);
    expect(screen.queryByRole("spinbutton")).toBeNull();await user.click(screen.getByRole("button",{name:"将first移至排名"}));
    const input=screen.getByRole("spinbutton",{name:"移至排名"});await user.clear(input);await user.type(input,"2");await user.click(screen.getByRole("button",{name:/^移至$/}));expect(onOrderChange).toHaveBeenCalledWith(["second","first"]);
    await user.click(screen.getByRole("button",{name:"将first下移"}));expect(onOrderChange).toHaveBeenLastCalledWith(["second","first"]);
  });
});
