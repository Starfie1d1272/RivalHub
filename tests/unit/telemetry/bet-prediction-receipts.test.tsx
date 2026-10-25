import { act,render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { configureTelemetry,flushTelemetry,resetTelemetryIdentity } from "@/lib/telemetry/client";
import type { ActionResult } from "@/types/action";
import type { TelemetryEvent } from "@/lib/telemetry/protocol";
import type { BetBoardDTO } from "@/lib/bet/types";
import type { FreePredictionModel } from "@/components/bet/presentation-contract";
const actions=vi.hoisted(()=>({mutate:vi.fn(),receipt:vi.fn()}));
vi.mock("@/actions/bet",()=>({mutateBet:actions.mutate,getBetStakeReceipt:actions.receipt}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()}),usePathname:()=>"/event/bet",useSearchParams:()=>new URLSearchParams()}));
vi.mock("@/components/telemetry/ContentReady",()=>({ContentReady:()=>null}));
vi.mock("sonner",()=>({toast:{error:vi.fn(),success:vi.fn()}}));
import { BetBoard } from "@/components/bet/BetBoard";
import { FreePrediction } from "@/components/bet/FreePrediction";

const config={endpoint:"https://receiver.invalid/v1/batches",ticket:"fixture",identity:"first",measurementVersion:1 as const,expiresAt:Date.now()+86400000};
let send:ReturnType<typeof vi.fn>;
beforeEach(()=>{window.history.replaceState(null,"","/event/bet");send=vi.fn().mockResolvedValue(new Response(null,{status:204}));vi.stubGlobal("fetch",send);configureTelemetry(config);});
afterEach(()=>{resetTelemetryIdentity();vi.unstubAllGlobals();vi.clearAllMocks();vi.restoreAllMocks();});
async function events(){await act(async()=>{});const before=send.mock.calls.length;vi.spyOn(Date,"now").mockReturnValue(Date.now()+1100);flushTelemetry();await vi.waitFor(()=>expect(send.mock.calls.length).toBeGreaterThan(before));return send.mock.calls.flatMap(call=>(JSON.parse(call[1].body).events as TelemetryEvent[]));}
const tasks=(rows:TelemetryEvent[])=>rows.filter(row=>row.kind==="task");
const base:BetBoardDTO={seasonId:"private-event",enabled:true,paused:false,joined:false,joinEligibility:{canJoin:true,reason:null},balance:"0",debt:"0",profit:"0",rank:null,leaderboard:[],records:[],markets:[],matches:[]};
const bet=(data:BetBoardDTO,refreshAction=vi.fn().mockResolvedValue(false),selected=false)=><BetBoard initial={data} slug="event" signedIn view="open" matchFilter={selected?"private-match":null} returnSelection={selected?{market:"private-market",option:"private-option"}:undefined} refreshAction={refreshAction}/>;
const model:FreePredictionModel={matchId:"private-match",kind:"winner",requiredChoices:1,options:[{key:"private-A",label:"甲队",count:0},{key:"private-B",label:"乙队",count:0}],own:[],participants:0,canSubmit:true,status:"open",reason:null,result:null};

it("completes join at its receipt even when refresh fails, then presents only after the joined wallet renders",async()=>{
  actions.mutate.mockResolvedValue({success:true,data:{joined:true}});
  const view=render(bet(base));await userEvent.setup().click(screen.getByRole("button",{name:"领取 1,000 积分"}));
  const first=tasks(await events());expect(first.filter(e=>e.task?.phase==="complete")).toHaveLength(1);expect(first.some(e=>e.task?.step==="result")).toBe(false);
  view.rerender(bet({...base,joined:true,balance:"1000"}));
  const all=tasks(await events());expect(all.filter(e=>e.task?.step==="result")).toHaveLength(1);
  expect(all.find(e=>e.task?.phase==="complete")!.task!.attemptId).toBe(all.find(e=>e.task?.step==="result")!.task!.attemptId);
  expect(actions.mutate).toHaveBeenCalledTimes(1);expect(JSON.stringify(all)).not.toContain("private-event");
});

it("keeps an unknown stake on one token, confirms by the original read receipt, and waits for displayed stake facts",async()=>{
  const market:BetBoardDTO["markets"][number]={id:"private-market",matchId:"private-match",type:"match_winner",title:"比赛胜者",help:"规则",group:"比赛",context:"",state:"open",pool:"0",participants:0,canStake:true,restriction:null,options:[{id:"private-option",label:"甲队",entity:null,pool:"0",percent:0,winner:false},{id:"other-option",label:"乙队",entity:null,pool:"0",percent:0,winner:false}],mine:null};
  const joined={...base,joined:true,balance:"1000",markets:[market],matches:[{id:"private-match",entryAId:"a",entryBId:"b",a:"甲队",b:"乙队",logoA:null,logoB:null,stage:"正赛",format:"BO1",scheduledAt:null}]};
  actions.mutate.mockRejectedValueOnce(new Error("fixture transport loss"));actions.receipt.mockResolvedValue({success:true,data:{status:"committed",amount:"25"}});
  const view=render(bet(joined,undefined,true));const user=userEvent.setup();
  await user.type(screen.getByLabelText("投入积分",{exact:true}),"25");await user.click(screen.getByRole("button",{name:"确认投入"}));
  await user.click(await screen.findByRole("button",{name:"核对投入结果"}));
  const first=tasks(await events());expect(first.filter(e=>e.task?.phase==="start")).toHaveLength(1);expect(first.filter(e=>e.task?.phase==="complete")).toHaveLength(1);expect(first.some(e=>e.task?.step==="result")).toBe(false);
  expect(actions.mutate).toHaveBeenCalledTimes(1);expect(actions.receipt).toHaveBeenCalledTimes(1);
  view.rerender(bet({...joined,balance:"975",markets:[{...market,mine:{optionId:"private-option",amount:"25",payout:null,profit:null}}]},undefined,true));
  const all=tasks(await events());expect(all.filter(e=>e.task?.step==="result")).toHaveLength(1);expect(new Set(all.filter(e=>e.task?.phase==="complete"||e.task?.step==="result").map(e=>e.task!.attemptId)).size).toBe(1);
  expect(send.mock.calls.flatMap(call=>JSON.parse(call[1].body).events).some((e:TelemetryEvent)=>e.kind==="ready"&&e.ready?.phase==="form")).toBe(false);
  await user.click(view.container.querySelector<HTMLButtonElement>('button[data-bet-option="private-option"]')!);
  const demandEvents=await events();expect(demandEvents.filter(e=>e.kind==="ready"&&e.ready?.module==="bet"&&e.ready.phase==="form")).toHaveLength(1);
  expect(actions.mutate).toHaveBeenCalledTimes(1);
});

it("completes free prediction before synchronous unmount without inventing presentation or replaying",async()=>{
  let resolve!:(value:ActionResult<FreePredictionModel>)=>void;const submitAction=vi.fn(()=>new Promise<ActionResult<FreePredictionModel>>(r=>{resolve=r;}));
  const view=render(<FreePrediction model={model} signedIn controls={{submitAction,refreshAction:vi.fn()}}/>);const user=userEvent.setup();
  await user.click(screen.getByRole("button",{name:/甲队/}));await user.click(screen.getByRole("button",{name:"提交预测"}));
  view.unmount();await act(async()=>resolve({success:true,data:{...model,own:["private-A"]}}));
  const rows=tasks(await events());expect(rows.filter(e=>e.task?.phase==="complete")).toHaveLength(1);expect(rows.some(e=>e.task?.step==="result")).toBe(false);expect(submitAction).toHaveBeenCalledTimes(1);expect(JSON.stringify(rows)).not.toMatch(/private-match|private-A/);
});

it("does not attribute a late free-prediction receipt to a new identity",async()=>{
  let resolve!:(value:ActionResult<FreePredictionModel>)=>void;const submitAction=vi.fn(()=>new Promise<ActionResult<FreePredictionModel>>(r=>{resolve=r;}));
  const view=render(<FreePrediction model={model} signedIn controls={{submitAction,refreshAction:vi.fn()}}/>);const user=userEvent.setup();
  await user.click(screen.getByRole("button",{name:/甲队/}));await user.click(screen.getByRole("button",{name:"提交预测"}));
  configureTelemetry({...config,identity:"second"});await act(async()=>resolve({success:true,data:{...model,own:["private-A"]}}));view.unmount();flushTelemetry();expect(send).not.toHaveBeenCalled();expect(submitAction).toHaveBeenCalledTimes(1);
});

it("records a free-prediction result only after its confirmed choice is rendered, leaving a rejection incomplete",async()=>{
  const submitAction=vi.fn().mockResolvedValueOnce({success:false,error:{code:"FORBIDDEN",message:"fixture refusal"}}).mockResolvedValueOnce({success:true,data:{...model,own:["private-A"]}});
  const refreshAction=vi.fn().mockResolvedValue({success:true,data:model});
  render(<FreePrediction model={model} signedIn controls={{submitAction,refreshAction}}/>);const user=userEvent.setup();
  await user.click(screen.getByRole("button",{name:/甲队/}));await user.click(screen.getByRole("button",{name:"提交预测"}));
  expect(tasks(await events()).some(e=>e.task?.phase==="complete")).toBe(false);
  await user.click(screen.getByRole("button",{name:/甲队/}));await user.click(screen.getByRole("button",{name:"提交预测"}));
  expect(screen.getByText("已提交",{exact:true})).toBeVisible();
  const rows=tasks(await events());expect(rows.filter(e=>e.task?.phase==="complete")).toHaveLength(1);expect(rows.filter(e=>e.task?.step==="result")).toHaveLength(1);
});
