import { act,render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import type { ComponentProps } from "react";
import { configureTelemetry,flushTelemetry,resetTelemetryIdentity } from "@/lib/telemetry/client";
import type { TelemetryEvent } from "@/lib/telemetry/protocol";
import type { PickEmBoardData } from "@/lib/predictions/data";
import type { Baseline,Pick } from "@/lib/predictions/types";
import type { PickEditor } from "@/components/predictions/PickEditor";
import { defaultPredictionRules } from "@/lib/predictions/rules";
const calls=vi.hoisted(()=>({mutate:vi.fn(),read:vi.fn()}));
vi.mock("@/actions/predictions",()=>({mutatePrediction:calls.mutate}));
vi.mock("@/lib/predictions/http-client",()=>({fetchPredictionBoard:calls.read}));
vi.mock("@/components/predictions/PickEmAchievement",()=>({PickEmAchievement:()=>null}));
vi.mock("@/components/predictions/TournamentBoard",()=>({TournamentBoard:()=>null}));
vi.mock("@/components/predictions/share-image",()=>({exportPredictionImage:vi.fn()}));
vi.mock("@/components/telemetry/ContentReady",()=>({ContentReady:()=>null}));
vi.mock("sonner",()=>({toast:{success:vi.fn(),error:vi.fn()}}));
vi.mock("@/components/predictions/PickEditor",()=>({PickEditor:({onSave,contest}:ComponentProps<typeof PickEditor>)=><><button onClick={()=>onSave(true)}>提交fixture预测</button><span>{contest.submitted?"fixture已提交":"fixture未提交"}</span></>}));
import { PredictionBoard } from "@/components/predictions/PredictionBoard";
const entrants=Array.from({length:16},(_,i)=>({teamId:`team-${i}`,seed:i+1}));
const pick:Pick={perfect:["team-0","team-1"],advance:entrants.slice(2,8).map(e=>e.teamId),eliminated:["team-8","team-9"]};
const base:Baseline={version:2,seasonId:"private-event",name:"赛事",capturedAt:"2026-10-01T00:00:00Z",stages:[{key:"stage1",name:"第一阶段",type:"swiss",previousKey:null,nextKey:null,directSeeds:[1,16],matchFormat:"bo1",entrySeeds:16,finalFormat:null}],teams:entrants.map(e=>({teamId:e.teamId,tournamentSeed:e.seed,name:e.teamId,logoUrl:null})),runs:[{id:"run",key:"stage1",entrants,finalizedRound:0}],matches:[]};
const initial:PickEmBoardData={view:"sim",base,contexts:[{kind:"major",baseline:base}],defaultContext:"major",enabled:true,joined:true,rules:defaultPredictionRules(base.stages),achievement:null,pickLeaderboard:[],contests:[{id:"private-contest",stageKey:"stage1",kind:"swiss",entrants,quarterfinals:[],deadline:null,deadlineTentative:false,locked:false,deadlineReached:false,voidReason:null,submitted:null,draft:pick,judgementRevisions:0}]};
const config={endpoint:"https://receiver.invalid/v1/batches",ticket:"fixture",identity:"viewer",measurementVersion:1 as const,expiresAt:Date.now()+86400000};
let send:ReturnType<typeof vi.fn>;
beforeEach(()=>{
  window.history.replaceState(null,"","/event/predictions");send=vi.fn().mockResolvedValue(new Response(null,{status:204}));vi.stubGlobal("fetch",send);configureTelemetry(config);
  vi.spyOn(HTMLElement.prototype,"getClientRects").mockImplementation(function(this:HTMLElement){return (this.id==="prediction-dock"&&document.querySelector('[aria-controls="prediction-dock"]')?.getAttribute("aria-expanded")==="true"?[new DOMRect(0,0,100,100)]:[]) as unknown as DOMRectList;});
});
afterEach(()=>{resetTelemetryIdentity();vi.unstubAllGlobals();vi.clearAllMocks();vi.restoreAllMocks();});
async function events(){await act(async()=>{});const before=send.mock.calls.length;vi.spyOn(Date,"now").mockReturnValue(Date.now()+1100);flushTelemetry();await vi.waitFor(()=>expect(send.mock.calls.length).toBeGreaterThan(before));return send.mock.calls.flatMap(c=>JSON.parse(c[1].body).events as TelemetryEvent[]);}

it("separates formal receipt from refreshed, visible Pick'Em and captures demand only on explicit opening",async()=>{
  calls.mutate.mockResolvedValue({success:true});let resolve!:(value:unknown)=>void;calls.read.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  render(<PredictionBoard initial={initial} slug="event" signedIn/>);const user=userEvent.setup();
  await user.click(screen.getByRole("button",{name:"展开预测单"}));
  await user.click(screen.getByRole("button",{name:"提交fixture预测"}));
  const receipt=await events();expect(receipt.filter(e=>e.task?.phase==="complete")).toHaveLength(1);expect(receipt.some(e=>e.task?.step==="result")).toBe(false);
  expect(receipt.filter(e=>e.kind==="ready"&&e.ready?.phase==="form")).toHaveLength(1);expect(JSON.stringify(receipt)).not.toContain('"basis":"demand"');
  await act(async()=>resolve({success:true,data:{...initial,contests:[{...initial.contests[0]!,submitted:{pick,version:1,at:"2026-10-01T00:00:00Z"}}]}}));
  expect(screen.getByText("fixture已提交")).toBeVisible();const all=await events();expect(all.filter(e=>e.task?.step==="result")).toHaveLength(1);expect(calls.mutate).toHaveBeenCalledTimes(1);
});
it("retains a formal receipt across unmount while withholding presentation",async()=>{
  let resolve!:(value:unknown)=>void;calls.mutate.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));calls.read.mockResolvedValue({success:true,data:initial});
  const view=render(<PredictionBoard initial={initial} slug="event" signedIn/>);const user=userEvent.setup();await user.click(screen.getByRole("button",{name:"展开预测单"}));await user.click(screen.getByRole("button",{name:"提交fixture预测"}));view.unmount();await act(async()=>resolve({success:true}));
  const rows=await events();expect(rows.filter(e=>e.task?.phase==="complete")).toHaveLength(1);expect(rows.some(e=>e.task?.step==="result")).toBe(false);
});
