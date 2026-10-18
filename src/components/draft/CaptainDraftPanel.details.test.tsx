import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CaptainDraftPanel } from "./CaptainDraftPanel";
import { pickPlayer } from "@/actions/draft";
import type { CaptainDraftPlayer } from "@/lib/draft/data";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), useParams: () => ({ seasonSlug: "rivals" }) }));
vi.mock("@/actions/draft", () => ({ pickPlayer: vi.fn() }));
vi.mock("@/components/use-visible-polling", () => ({ useRoutePolling: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const player: CaptainDraftPlayer = { registrationId: "player-1", userId: "user-1", avatarUrl: null, personaName: "Neo", perfectName: null, displayName: null, primaryPosition: "igl", secondaryPosition: "anchor", peakRank: "S", peakRating: 2, currentRank: "A+", currentRating: 1.5, mapPreferences: [], gameplayStyle: "稳健控图", notes: null, competitionHistory: null, createdAt: "2026-01-01" };
const props = { seasonId: "rivals", entryId: "alpha", teamName: "Alpha", currentTeamName: "Alpha", currentRound: 2, roundDeadline: null, isDraftActive: true, isCurrentCaptainTurn: true, positionCounts: { igl: 1 }, players: [player], seasonPositions: ["igl"], rosterMembers: [], captainPosition: "igl" };
it("keeps script-dependent controls disabled in the server response", () => {
  const markup = document.createElement("div");
  markup.innerHTML = renderToStaticMarkup(<CaptainDraftPanel {...props} />);
  const buttons = [...markup.querySelectorAll("button")];
  expect(buttons.filter(button => button.textContent === "准备中…")).toHaveLength(2);
  const controls = buttons.filter(button => /准备中|我的阵容|全部|选入|\/2/.test(button.textContent ?? ""));
  expect(controls.length).toBeGreaterThan(4);
  expect(controls.every(button => button.disabled)).toBe(true);
  expect(markup.querySelector("input")).toBeDisabled();
  expect(pickPlayer).not.toHaveBeenCalled();
});
// Reading must not mutate the draft, and a fresh turn restriction still owns selection.
it("opens readable candidate details without selecting and keeps another turn disabled", async () => {
  const user = userEvent.setup();
  render(<CaptainDraftPanel {...props} isCurrentCaptainTurn={false} />);
  const button = screen.getAllByRole("button", { name: "详情" })[0]!;
  await user.click(button);
  const detail = screen.getByRole("region", { name: "选手详情 · Neo" });
  expect(within(detail).getByText("稳健控图")).toBeVisible();
  expect(button).toHaveAttribute("aria-expanded", "true");
  expect(within(detail).getByRole("button", { name: "选入本队" })).toBeDisabled();
  expect(pickPlayer).not.toHaveBeenCalled();
  await user.click(button);
  expect(screen.queryByRole("region", { name: "选手详情 · Neo" })).not.toBeInTheDocument();
  expect(pickPlayer).not.toHaveBeenCalled();
});
