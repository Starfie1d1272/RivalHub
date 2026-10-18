import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { BetReliefDTO } from "@/lib/bet/relief";
import { BetRelief } from "./BetRelief";

// The browser flow checks the ledger; this protects its missing first-click
// boundary between a visible server-rendered button and attached handlers.
it("disables the SSR claim and confirms the first hydrated click", async () => {
  const user = userEvent.setup();
  const model: BetReliefDTO = { day: "2026-10-18", reason: "eligible", canClaim: true, amount: "10", granted: "0", remaining: "100" };
  const receipt: BetReliefDTO = { ...model, reason: "claimed_today", canClaim: false, amount: "0", granted: "10", remaining: "90" };
  const claimAction = vi.fn().mockResolvedValue({ success: true, data: receipt });
  const refreshAction = vi.fn();
  const onClaimed = vi.fn();
  const view = <BetRelief model={model} claimAction={claimAction} refreshAction={refreshAction} onClaimed={onClaimed} />;
  const container = document.createElement("div");
  container.innerHTML = renderToString(view);
  document.body.appendChild(container);
  const claim = within(container).getByRole("button", { name: "领取低保 +10" });
  expect(claim).toBeDisabled();
  claim.click();
  expect(claimAction).not.toHaveBeenCalled();
  render(view, { container, hydrate: true });
  expect(claim).toBeEnabled();
  await user.click(claim);
  expect(await screen.findByText("今日已领低保", { exact: true })).toBeVisible();
  expect(claimAction).toHaveBeenCalledExactlyOnceWith(model.day);
  expect(onClaimed).toHaveBeenCalledTimes(1);
  expect(refreshAction).not.toHaveBeenCalled();
});
