import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ScoreInput } from "@/components/matches/ScoreInput";

const mocks = vi.hoisted(() => ({ update: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/actions/matches", () => ({ updateMatchStatus: mocks.update }));
vi.mock("@/lib/telemetry/client", () => ({ observeAction: (_name: string, work: unknown) => work }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

beforeEach(() => vi.clearAllMocks());

it("shows the match and its cancellation impact before submitting, with safe keyboard cancellation", async () => {
  mocks.update.mockResolvedValue({ success: true, data: undefined });
  const user = userEvent.setup();
  render(<ScoreInput matchId="match" currentStatus="scheduled" matchLabel="甲队 vs 乙队"
    impact={{ test: false, managed: true, bet: true }} />);
  const entry = screen.getByRole("button", { name: "取消比赛" });
  await user.click(entry);
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent("甲队 vs 乙队");
  expect(dialog).toHaveTextContent(/解说认领/);
  expect(dialog).toHaveTextContent(/盘口/);
  expect(mocks.update).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() => expect(entry).toHaveFocus());
  expect(mocks.update).not.toHaveBeenCalled();
  await user.click(entry);
  await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "确认取消比赛" }));
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith("match", "cancelled");
});
