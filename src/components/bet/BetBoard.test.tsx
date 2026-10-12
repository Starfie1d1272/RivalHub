import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BetBoard } from "./BetBoard";
import { marketPresentation } from "@/lib/bet/presentation";
import type { BetBoardDTO, BetMarketDTO } from "@/lib/bet/types";

vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/actions/bet",()=>({getBetBoard:vi.fn(),mutateBet:vi.fn()}));
const names=["Ancient","Anubis","Dust2","Inferno","Mirage","Nuke","Overpass"];
const market:BetMarketDTO={id:"presence",matchId:"match",type:"veto_present",...marketPresentation("veto_present",null),context:"",state:"open",pool:"100",participants:2,canStake:true,restriction:null,mine:null,options:names.map((label,i)=>({id:`o${i}`,label,entity:null,pool:i===0?"10":i===1?"90":"0",percent:i===0?10:i===1?90:0,winner:false}))};
const initial:BetBoardDTO={seasonId:"season",enabled:true,paused:false,joined:true,balance:"1000",debt:"0",profit:"0",rank:null,leaderboard:[],records:[],markets:[market],matches:[{id:"match",entryAId:"a",entryBId:"b",a:"甲",b:"乙",logoA:null,logoB:null,stage:"Stage 1",format:"BO3",scheduledAt:null}]};
// A seven-choice, three-winner pool must not present the misleading single-winner
// payout formula. PG evidence separately proves the financial settlement owner.
describe("BO3 presence investment presentation",()=>{
  it("shows seven options and shared-pool support without a single-winner return estimate",async()=>{
    const user=userEvent.setup();
    render(<BetBoard initial={initial} slug="test" signedIn view="open" matchFilter={null}/>);
    const row=screen.getByRole("region",{name:"BP · 本场三图"});
    expect(within(row).getAllByRole("button").filter(button=>names.some(name=>button.textContent?.includes(name)))).toHaveLength(7);
    expect(within(row).getByRole("button",{name:/Ancient/})).toHaveTextContent("10%10");
    await user.click(within(row).getByRole("button",{name:/Ancient/}));
    await user.type(screen.getByLabelText("投入积分"),"100");
    const dialog=screen.getByRole("dialog");
    expect(within(dialog).queryByText(/≈/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button",{name:"预计返还说明"}));
    expect(screen.getByRole("tooltip")).toHaveTextContent("三张有效地图共同中奖");
    expect(screen.getByRole("tooltip")).toHaveTextContent("无人或全部投入中奖时原额退款");
    expect(within(dialog).getByRole("button",{name:"确认投入"})).toBeEnabled();
  });
});

// These checks protect the removed inline forms and the shared entry boundary:
// a financial restriction must never block an independent free prediction.
it("keeps forms behind one entry and allows free prediction with a paused empty wallet",async()=>{
  const user=userEvent.setup();
  const winner:BetMarketDTO={...market,id:"winner",type:"match_winner",...marketPresentation("match_winner",null),canStake:false,options:market.options.slice(0,2)};
  const prediction={matchId:"match",kind:"winner" as const,requiredChoices:1,options:[{key:"a",label:"甲",count:0},{key:"b",label:"乙",count:0}],own:[],participants:0,canSubmit:true,status:"open" as const,reason:null,result:null};
  const submitAction=vi.fn().mockResolvedValue({success:false,error:{code:"INTERNAL_ERROR",message:"预测提交失败，请重试。"}});
  render(<BetBoard initial={{...initial,balance:"0",paused:true,markets:[winner]}} slug="test" signedIn view="open" matchFilter={null} predictions={[prediction]} predictionControls={{submitAction,refreshAction:async()=>({success:true,data:prediction})}}/>);
  expect(screen.queryByRole("region",{name:"免费赛果预测"})).not.toBeInTheDocument();
  const entry=within(screen.getByRole("tabpanel",{name:/赛果/})).getByRole("button",{name:/Ancient/});
  await user.click(entry);
  const free=within(screen.getByRole("region",{name:"免费赛果预测"}));
  await user.click(free.getByRole("button",{name:/乙/}));
  expect(screen.getByRole("button",{name:"确认投入"})).toBeDisabled();
  await user.click(free.getByRole("button",{name:"提交预测"}));
  expect(submitAction).toHaveBeenCalledWith(prediction,["b"]);
  expect(await screen.findByRole("alert")).toHaveTextContent("预测提交失败");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(entry).toHaveFocus();
});
