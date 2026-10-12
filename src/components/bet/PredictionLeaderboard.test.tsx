import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PredictionLeaderboard } from "./PredictionLeaderboard";
import type { PredictionRankingRow } from "./presentation-contract";

// The read owner owns qualification. Protect tab/tooltip consistency so users
// are not told that their officially ranked one-result hit total needs P75.
describe("prediction ranking qualification presentation",()=>{
  it("switches the displayed floor, rank and rule with the selected leaderboard",async()=>{
    const user=userEvent.setup();
    const row:PredictionRankingRow={userId:"spectator",playerUserId:null,name:"单场观众",profit:null,hits:1,decided:1,accuracy:1,rank:null};
    render(<PredictionLeaderboard rankings={{
      profit:{rows:[row],rankedCount:0,floor:null},
      hits:{rows:[{...row,rank:3}],rankedCount:1,floor:1},
      accuracy:{rows:[row],rankedCount:0,floor:3},
    }}/>);
    await user.click(screen.getByRole("button",{name:"赛果命中次数"}));
    expect(screen.getByText(/至少 1 场/)).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("#3")).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"赛果排名资格说明"}));
    expect(screen.getByRole("tooltip")).toHaveTextContent("至少一场有效已判定");
    expect(screen.getByRole("tooltip")).not.toHaveTextContent("P75");
    await user.click(screen.getByRole("button",{name:"赛果命中率"}));
    expect(screen.getByText(/至少 3 场/)).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByText("#3")).not.toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("100.0%")).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"赛果排名资格说明"}));
    expect(screen.getByRole("tooltip")).toHaveTextContent("P75 × 25%");
  });
});
