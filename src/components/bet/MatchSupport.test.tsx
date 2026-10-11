import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MatchSupport } from "./MatchSupport";

const props = { slug: "event", matchId: "match", teamA: { entryId: "a", name: "银河" }, teamB: { entryId: "b", name: "新星" } };
// Protect identity alignment, empty-data honesty and complementary rounding;
// the existing BET tests cover transactions, not this public projection.
describe("match support presentation", () => {
  it.each([
    ["1", "2", "33.3%", "66.7%"],
    ["1", "15", "6.3%", "93.7%"],
    ["100", "0", "100.0%", "0.0%"],
    ["0", "100", "0.0%", "100.0%"],
    ["900719925474099300000", "1801439850948198600000", "33.3%", "66.7%"],
  ])("aligns %s:%s points by team ID, even with reversed options", (a, b, left, right) => {
    render(<MatchSupport {...props} amounts={[{ entryId: "b", amount: b }, { entryId: "a", amount: a }]} />);
    expect(screen.getByLabelText(`银河 ${left}，新星 ${right}`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "银河" })).toHaveAttribute("href", "/event/teams/a");
    expect(screen.getByRole("link", { name: "新星" })).toHaveAttribute("href", "/event/teams/b");
  });
  it.each([
    [{ entryId: "a", amount: "0" }, { entryId: "b", amount: "0" }],
    [{ entryId: "old-team", amount: "100" }, { entryId: "b", amount: "200" }],
  ])("does not fabricate support for empty or corrected matchups", (...amounts) => {
    render(<MatchSupport {...props} amounts={amounts} />);
    expect(screen.getByLabelText("暂无支持率数据")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
  it("keeps the explanation in an independent keyboard-accessible help control", async () => {
    const user = userEvent.setup();
    const { container } = render(<MatchSupport {...props} amounts={[{ entryId: "a", amount: "1" }, { entryId: "b", amount: "2" }]} />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("button", { name: "支持率说明" })).toHaveFocus();
    expect(screen.getByRole("tooltip")).toHaveTextContent("不代表获胜概率或支持人数比例");
    expect(screen.getByRole("link", { name: "查看盘口 →" })).toHaveAttribute("href", "/event/bet?match=match");
    expect(container.querySelector("a button, a a")).toBeNull();
  });
});
