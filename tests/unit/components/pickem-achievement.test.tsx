import {act,render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,expect,it,vi} from "vitest";
const read=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/predictions/http-client",()=>({fetchPickEmSummary:read}));
import {PickEmAchievement} from "@/components/predictions/PickEmAchievement";
import type {PickEmBoardData,PickEmSummary} from "@/lib/predictions/data";
const base={version:2,seasonId:"fixture",name:"验收",capturedAt:"2026-10-19T00:00:00Z",stages:[],teams:[],runs:[],matches:[]};
const data:PickEmBoardData={view:"sim",base,contexts:[{kind:"major",baseline:base}],defaultContext:"major",enabled:true,joined:true,contests:[],achievement:null,pickLeaderboard:[],rules:{perfect:1,advance:7,eliminated:1,swissTarget:5,silver:2,gold:5,diamond:8}};
function summary(label:string,ranking=false):PickEmSummary {
  return {achievement:ranking?null:{accountId:"viewer",name:"我",challenges:0,coin:"未获得",maximumCoin:"青铜",hits:0,progress:[{key:"stage",name:"阶段",locked:false,judged:false,hits:null,challenges:0,possible:1,tasks:[{key:"submission",label,state:"active",progress:0,target:1}]}]},
    pickLeaderboard:ranking?[{name:label,value:"9",coin:"白银",rank:1,isMe:false}]:[],mine:null};
}
beforeEach(()=>{read.mockReset();});
it("first leaderboard opening reads ranking and renders its existing population",async()=>{
  const user=userEvent.setup();read.mockResolvedValue({success:true,data:summary("领跑者",true)});
  render(<PickEmAchievement data={data} signedIn/>);
  await user.click(screen.getByRole("button",{name:"排行榜"}));
  expect(read.mock.calls[0]![0]).toEqual({seasonId:"fixture",view:"ranking"});
  expect(await screen.findByText("领跑者")).toBeVisible();
});
it("alternating popovers always requests the newly selected section",async()=>{
  const user=userEvent.setup();read.mockImplementation(({view}:{view:string})=>Promise.resolve({success:true,data:summary(view==="tasks"?"当前任务":"当前榜单",view==="ranking")}));
  render(<PickEmAchievement data={data} signedIn/>);
  await user.click(screen.getByRole("button",{name:"任务"}));
  expect(await screen.findByText("当前任务")).toBeVisible();await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button",{name:"排行榜"}));
  expect(await screen.findByText("当前榜单")).toBeVisible();await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button",{name:"任务"}));
  expect(await screen.findByText("当前任务")).toBeVisible();
  expect(read.mock.calls.map(call=>call[0].view)).toEqual(["tasks","ranking","tasks"]);
});
it("a late leaderboard response cannot replace newer task data",async()=>{
  const user=userEvent.setup();let finish!:(value:unknown)=>void;
  read.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;})).mockResolvedValueOnce({success:true,data:summary("新任务")});
  render(<PickEmAchievement data={data} signedIn/>);
  await user.click(screen.getByRole("button",{name:"排行榜"}));await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button",{name:"任务"}));
  expect(await screen.findByText("新任务")).toBeVisible();
  await act(async()=>finish({success:true,data:summary("旧榜单",true)}));
  expect(screen.getByText("新任务")).toBeVisible();expect(screen.queryByText("旧榜单")).toBeNull();
});
