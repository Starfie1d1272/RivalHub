/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminSelectMatchRoster,
  confirmMatchRoster,
} from "@/actions/matches/roster";
import { AdminRosterDialog } from "@/components/matches/AdminRosterDialog";
import type { RosterData } from "@/components/matches/AdminMatchRow";
import { ok } from "@/types/action";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/actions/matches/roster", () => ({
  adminSelectMatchRoster: vi.fn(),
  confirmMatchRoster: vi.fn(),
  unlockMatchRoster: vi.fn(),
  submitMatchRoster: vi.fn(),
}));

const mockedAdminSelect = vi.mocked(adminSelectMatchRoster);
const mockedConfirm = vi.mocked(confirmMatchRoster);

function member(id: string) {
  return { id, steamName: id, displayName: null, perfectName: null, primaryPosition: "rifler" };
}

const MEMBERS_A = ["a1", "a2", "a3", "a4", "a5", "a6"].map(member);
const MEMBERS_B = ["b1", "b2", "b3", "b4", "b5", "b6"].map(member);

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "管理名单" }));
}

/** Checks five member checkboxes within one team section. */
async function pickFiveStarters(user: ReturnType<typeof userEvent.setup>, prefix: string) {
  const checkboxes = screen.getAllByRole("checkbox");
  // Checkbox order follows member order per team section; team A first.
  const scoped = checkboxes.filter((box) => {
    const label = box.closest("label")?.textContent ?? "";
    return label.startsWith(prefix);
  });
  expect(scoped.length).toBe(6);
  for (const box of scoped.slice(0, 5)) {
    await user.click(box);
  }
}

beforeEach(() => {
  mockedAdminSelect.mockReset();
  mockedConfirm.mockReset();
});

describe("AdminRosterDialog — explicit two-step lineup selection", () => {
  it("requires reviewing the exact five starters before recording an admin selection", async () => {
    const user = userEvent.setup();
    mockedAdminSelect.mockResolvedValue(ok({ rosterId: "roster-new" }));
    render(
      <AdminRosterDialog
        matchId="match-1"
        teamAName="Alpha"
        teamBName="Beta"
        teamAId="team-a"
        teamBId="team-b"
        teamAMembers={MEMBERS_A}
        teamBMembers={MEMBERS_B}
        teamARoster={null}
        teamBRoster={null}
      />,
    );

    await openDialog(user);
    await pickFiveStarters(user, "a");

    await user.click(screen.getAllByRole("button", { name: /核对并保存 Alpha 名单/ })[0]!);

    // Review state lists the exact five players before any action fires.
    expect(screen.getByText(/请核对将保存的首发五人/)).toBeInTheDocument();
    expect(screen.getByText(/首发 1\. a1/)).toBeInTheDocument();
    expect(screen.getByText(/首发 5\. a5/)).toBeInTheDocument();
    expect(mockedAdminSelect).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认保存" }));

    await waitFor(() => expect(mockedAdminSelect).toHaveBeenCalled());
    const [matchId, teamId, payload] = mockedAdminSelect.mock.calls[0]!;
    expect(matchId).toBe("match-1");
    expect(teamId).toBe("team-a");
    expect(payload!.starterIds).toEqual(["a1", "a2", "a3", "a4", "a5"]);
    expect(payload!.substituteIds).toEqual([]);
  });

  it("offers confirmation for saved-but-unconfirmed rosters and stays silent once confirmed", async () => {
    const user = userEvent.setup();
    mockedConfirm.mockResolvedValue(
      ok({ alreadyConfirmed: false, matchId: "match-1", teamId: "team-a" }),
    );
    const pending: RosterData = {
      rosterId: "roster-a",
      starters: ["a1", "a2", "a3", "a4", "a5"],
      substitutes: [],
      status: "submitted",
    };
    render(
      <AdminRosterDialog
        matchId="match-1"
        teamAName="Alpha"
        teamBName="Beta"
        teamAId="team-a"
        teamBId="team-b"
        teamAMembers={MEMBERS_A}
        teamBMembers={MEMBERS_B}
        teamARoster={pending}
        teamBRoster={null}
      />,
    );

    await openDialog(user);
    const confirmButton = screen.getByRole("button", { name: "确认名单" });
    await user.click(confirmButton);

    await waitFor(() => expect(mockedConfirm).toHaveBeenCalledWith("roster-a"));
  });

  it("does not offer a confirm button for already-confirmed rosters", async () => {
    const user = userEvent.setup();
    const confirmed: RosterData = {
      rosterId: "roster-b",
      starters: ["b1", "b2", "b3", "b4", "b5"],
      substitutes: [],
      status: "confirmed",
    };
    render(
      <AdminRosterDialog
        matchId="match-1"
        teamAName="Alpha"
        teamBName="Beta"
        teamAId="team-a"
        teamBId="team-b"
        teamAMembers={MEMBERS_A}
        teamBMembers={MEMBERS_B}
        teamARoster={null}
        teamBRoster={confirmed}
      />,
    );

    await openDialog(user);
    expect(mockedConfirm).not.toHaveBeenCalled();
    // Only team A's section renders an inline confirm control; team B shows 已确认.
    expect(screen.getByText(/已确认/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认名单" })).not.toBeInTheDocument();
  });

  it("blocks saving until exactly five starters are selected", async () => {
    const user = userEvent.setup();
    render(
      <AdminRosterDialog
        matchId="match-1"
        teamAName="Alpha"
        teamBName="Beta"
        teamAId="team-a"
        teamBId="team-b"
        teamAMembers={MEMBERS_A}
        teamBMembers={MEMBERS_B}
        teamARoster={null}
        teamBRoster={null}
      />,
    );

    await openDialog(user);
    const saveButtons = screen.getAllByRole("button", { name: /核对并保存 .* 名单/ });
    for (const button of saveButtons) {
      expect(button).toBeDisabled();
    }
    expect(mockedAdminSelect).not.toHaveBeenCalled();
  });
});
