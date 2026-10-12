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
