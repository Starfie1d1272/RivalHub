import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { operateBet } from "@/actions/bet";
import type { BetBoardDTO } from "@/lib/bet/types";
import { BetOperations } from "./BetOperations";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/test/bet",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/actions/bet", () => ({ operateBet: vi.fn() }));

// Existing financial evidence begins after an enabled entry. This protects the
// missing SSR → hydration → first confirmation boundary without writing money.
it("keeps the SSR entry disabled and handles the first hydrated click without submitting", async () => {
  const user = userEvent.setup();
  const data: BetBoardDTO = { seasonId: "season", enabled: false, paused: false, joined: false, balance: "0", debt: "0", profit: "0", rank: null, leaderboard: [], records: [], markets: [], matches: [] };
  const board = <BetOperations data={data} slug="test" pending={false} query={{ q: "", state: "", category: "", stage: "", page: 1 }} />;
  const container = document.createElement("div");
  container.innerHTML = renderToString(board);
  document.body.appendChild(container);
  const entry = within(container).getByRole("button", { name: /^启用 BET$/ });
  expect(entry).toBeDisabled();
  expect(within(container).getByRole("status")).toHaveTextContent("正在准备操作");
  entry.click();
  expect(within(container).queryByRole("region", { name: "BET 操作确认" })).not.toBeInTheDocument();

  render(board, { container, hydrate: true });
  expect(entry).toBeEnabled();
  await user.click(entry);
  const confirmation = screen.getByRole("region", { name: "BET 操作确认" });
  expect(confirmation).toBeVisible();
  await user.dblClick(entry);
  expect(screen.getAllByRole("region", { name: "BET 操作确认" })).toHaveLength(1);
  await user.click(within(confirmation).getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("region", { name: "BET 操作确认" })).not.toBeInTheDocument();
  entry.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("region", { name: "BET 操作确认" })).toBeVisible();
  expect(operateBet).not.toHaveBeenCalled();
});
