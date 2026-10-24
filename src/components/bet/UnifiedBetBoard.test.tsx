import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { BetBoardDTO } from "@/lib/bet/types";
import type { BetBoard } from "./BetBoard";
import { UnifiedBetBoard } from "./UnifiedBetBoard";

const actions=vi.hoisted(()=>({getUnifiedBetBoard:vi.fn(),getFreePredictionMatch:vi.fn(),getFreePredictionRanking:vi.fn(),submitFreePrediction:vi.fn()}));
vi.mock("@/actions/bet",()=>({...actions,claimBetRelief:vi.fn(),getBetRelief:vi.fn()}));
vi.mock("@/actions/free-predictions",()=>actions);
vi.mock("@/lib/bet/http-client",()=>({fetchBetBoard:actions.getUnifiedBetBoard}));
vi.mock("@/lib/telemetry/client",()=>({observeAction:(_name:string,action:unknown)=>action}));
vi.mock("./BetBoard",()=>({BetBoard:({initial,refreshAction}:ComponentProps<typeof BetBoard>)=><><output aria-label="余额">{initial.balance}</output><button onClick={()=>void refreshAction()}>提交后回读</button></>}));
const initial:BetBoardDTO={seasonId:"event",enabled:true,paused:false,joined:true,balance:"1000",debt:"0",profit:"0",rank:null,leaderboard:[],records:[],markets:[],matches:[]};
const reply=(balance:string)=>({success:true as const,data:{bet:{...initial,balance},free:{seasonId:initial.seasonId,matches:[]}}});
const view=(active="open")=> <UnifiedBetBoard initial={initial} freeMatches={[]} slug="event" signedIn view={active} matchFilter={null} reliefModel={{day:"2026-10-22",canClaim:false,reason:"balance_sufficient",amount:"0",granted:"0",remaining:"100"}}/>;
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
// Fake time protects the promised cadence; deferred responses protect a real
// mutation race that PostgreSQL tests cannot observe in the mounted client.
it("polls once per 15 seconds, skips overlaps, and discards a pre-mutation response",async()=>{
  vi.useFakeTimers({toFake:["setInterval","clearInterval"]});
  const user=userEvent.setup();
  let resolve!:(value:ReturnType<typeof reply>)=>void;
  actions.getUnifiedBetBoard.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue(reply("900"));
  render(view());
  await act(()=>vi.advanceTimersByTimeAsync(15000));
  expect(actions.getUnifiedBetBoard).toHaveBeenCalledTimes(1);
  await act(()=>vi.advanceTimersByTimeAsync(15000));
  expect(actions.getUnifiedBetBoard).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button",{name:"提交后回读"}));
  expect(actions.getUnifiedBetBoard.mock.calls[0]![1].aborted).toBe(true);
  await act(async()=>{resolve(reply("950"));});
  expect(actions.getUnifiedBetBoard).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText("余额")).toHaveTextContent("900");
  await act(()=>vi.advanceTimersByTimeAsync(15000));
  expect(actions.getUnifiedBetBoard).toHaveBeenCalledTimes(3);
});
it("stops background reads while hidden and refreshes on return",async()=>{
  vi.useFakeTimers({toFake:["setInterval","clearInterval"]});actions.getUnifiedBetBoard.mockResolvedValue(reply("800"));
  const visibility=vi.spyOn(document,"visibilityState","get");
  visibility.mockReturnValue("visible");render(view());
  visibility.mockReturnValue("hidden");
  await act(async()=>{document.dispatchEvent(new Event("visibilitychange"));await vi.advanceTimersByTimeAsync(30000);});
  expect(actions.getUnifiedBetBoard).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  await act(async()=>{document.dispatchEvent(new Event("visibilitychange"));});
  expect(actions.getUnifiedBetBoard).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("余额")).toHaveTextContent("800");
  visibility.mockRestore();
});

it.each(["records","leaderboard"])("does not poll a %s view that has its own consumers",async active=>{
  vi.useFakeTimers({toFake:["setInterval","clearInterval"]});render(view(active));
  await act(()=>vi.advanceTimersByTimeAsync(60000));
  expect(actions.getUnifiedBetBoard).not.toHaveBeenCalled();
});
