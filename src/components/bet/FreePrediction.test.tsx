import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FreePrediction } from "./FreePrediction";
import type { FreePredictionModel, FreePredictionControls } from "./presentation-contract";

const model: FreePredictionModel = { matchId: "fictional", kind: "winner", requiredChoices: 1, options: [{ key: "a", label: "测试甲", count: 0 }, { key: "b", label: "测试乙", count: 0 }], own: [], participants: 0, canSubmit: true, status: "open", reason: null, result: null };
const controls = (): FreePredictionControls => ({ submitAction: vi.fn<FreePredictionControls["submitAction"]>(async (panel, keys) => ({ success: true, data: { ...panel, own: keys } })), refreshAction: vi.fn<FreePredictionControls["refreshAction"]>(async panel => ({ success: true, data: panel })) });

// Protect independent submission and fresh official locks; existing BET E2E does
// not exercise free selections, DTO refreshes or rejected cached permissions.
describe("independent free prediction interaction", () => {
  it("keeps a draft across equivalent DTO refresh, cancels it and explicitly submits", async () => {
    const user = userEvent.setup(); const actions = controls();
    const { rerender } = render(<FreePrediction model={model} signedIn controls={actions}/>);
    await user.click(screen.getByRole("button", { name: /测试甲/ }));
    rerender(<FreePrediction model={{ ...model }} signedIn controls={actions}/>);
    expect(screen.getByRole("button", { name: /测试甲/ })).toHaveAttribute("aria-pressed", "true");
    expect(actions.submitAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "取消改选" }));
    expect(screen.getByRole("button", { name: /测试甲/ })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: /测试乙/ }));
    await user.click(screen.getByRole("button", { name: "提交预测" }));
    expect(actions.submitAction).toHaveBeenCalledWith(expect.objectContaining({ matchId: "fictional", kind: "winner" }), ["b"]);
    expect(await screen.findByText("已提交")).toBeInTheDocument();
  });
  it("refreshes community counts and reason without discarding the current draft", async () => {
    const user = userEvent.setup(); const actions = controls();
    const { rerender } = render(<FreePrediction model={model} signedIn controls={actions}/>);
    await user.click(screen.getByRole("button", { name: /测试甲/ }));
    rerender(<FreePrediction model={{ ...model, participants: 2, options: model.options.map(option => ({ ...option, count: 1 })), reason: "最新服务端提示" }} signedIn controls={actions}/>);
    expect(screen.getAllByText("50.0% · 1 人")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /测试甲/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("最新服务端提示");
  });
  it("refreshes a rejected cached open state and keeps the error visible after locking", async () => {
    const user = userEvent.setup(); const actions = controls();
    actions.submitAction = vi.fn<FreePredictionControls["submitAction"]>(async () => ({ success: false, error: { code: "FORBIDDEN", message: "实际对局已开始" } }));
    actions.refreshAction = vi.fn<FreePredictionControls["refreshAction"]>(async panel => ({ success: true, data: { ...panel, canSubmit: false, status: "locked" } }));
    render(<FreePrediction model={model} signedIn controls={actions}/>);
    await user.click(screen.getByRole("button", { name: /测试甲/ })); await user.click(screen.getByRole("button", { name: "提交预测" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("实际对局已开始");
    expect(screen.getByRole("button", { name: /测试甲/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "提交预测" })).not.toBeInTheDocument();
  });
  it("never lets a delayed response replace a newer locked DTO", async () => {
    const user = userEvent.setup(); const actions = controls();
    let resolve!: (value: Awaited<ReturnType<FreePredictionControls["submitAction"]>>) => void;
    actions.submitAction = vi.fn<FreePredictionControls["submitAction"]>(() => new Promise(done => { resolve = done; }));
    const { rerender } = render(<FreePrediction model={model} signedIn controls={actions}/>);
    await user.click(screen.getByRole("button", { name: /测试甲/ })); await user.click(screen.getByRole("button", { name: "提交预测" }));
    rerender(<FreePrediction model={{ ...model, canSubmit: false, status: "locked" }} signedIn controls={actions}/>);
    resolve({ success: true, data: { ...model, own: ["a"] } });
    expect(await screen.findByText("已锁定")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /测试甲/ })).toBeDisabled();
  });
  it("shows a login link for guests and leaves an unsubmitted independent BP panel untouched", async () => {
    const user = userEvent.setup(); const actions = controls();
    render(<><FreePrediction model={model} signedIn controls={actions}/><FreePrediction model={{ ...model, kind: "bp" }} signedIn={false} controls={actions}/></>);
    const winner = within(screen.getByRole("region", { name: "免费赛果预测" }));
    const bp = within(screen.getByRole("region", { name: "免费 BP 预测" }));
    await user.click(winner.getByRole("button", { name: /测试甲/ })); await user.click(winner.getByRole("button", { name: "提交预测" }));
    expect(bp.getByRole("button", { name: /测试甲/ })).toBeDisabled();
    expect(bp.getByRole("link", { name: "登录预测" })).toHaveAttribute("href", "/login");
    expect(bp.getByText(/尚未提交/)).toBeInTheDocument();
  });
});
