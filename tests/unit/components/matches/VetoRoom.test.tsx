/** @vitest-environment jsdom */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@/types/action";
import type { VetoRoomView } from "@/lib/matches/veto-room/read-model";

const actionMocks = vi.hoisted(() => ({
  readVetoRoom: vi.fn(),
  reconcileVetoRoomTimeoutAction: vi.fn(),
  performVetoRoomCommand: vi.fn(),
  claimVetoRepresentativeAction: vi.fn(),
  pauseVetoRoomAction: vi.fn(),
  requestVetoRoomStart: vi.fn(),
  resolveVetoRoomAppeal: vi.fn(),
  resumeVetoRoomAction: vi.fn(),
  rewindVetoRoomAction: vi.fn(),
  setManualVetoPrivilege: vi.fn(),
  submitVetoRoomAppeal: vi.fn(),
  updateVetoRepresentative: vi.fn(),
}));

vi.mock("@/actions/matches/veto-room", () => actionMocks);

import { VetoRoom } from "@/components/matches/VetoRoom";

function roomFixture(): VetoRoomView {
  const serverNow = new Date().toISOString();
  return {
    seasonSlug: "rivals",
    seasonName: "Rivals",
    match: {
      id: "00000000-0000-4000-8000-000000000001",
      stage: "PLAY-IN",
      round: 1,
      format: "BO3",
      formatKey: "bo3",
      statusKey: "in_progress",
      statusLabel: "进行中",
      scheduledAt: serverNow,
      entryAId: "00000000-0000-4000-8000-000000000002",
      entryBId: "00000000-0000-4000-8000-000000000003",
    },
    entries: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        name: "Alpha",
        vetoRoleLabel: "VETO A",
        rosterConfirmed: true,
        rosterStatusLabel: "首发已确认",
        lineupBlocker: null,
        starters: [{ id: "00000000-0000-4000-8000-000000000004", name: "Alpha Player", isVetoRepresentative: true, isViewer: true }],
        vetoRepresentativeMemberId: "00000000-0000-4000-8000-000000000004",
        vetoRepresentativeName: "Alpha Player",
        startRequested: true,
        isViewerEntryRepresentative: false,
        isViewerVetoRepresentative: true,
        mayEditRepresentative: false,
        mayReassignRepresentative: false,
        mayClaimRepresentative: false,
        mayRequestStart: false,
        mayChooseVetoRole: false,
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        name: "Beta",
        vetoRoleLabel: "VETO B",
        rosterConfirmed: true,
        rosterStatusLabel: "首发已确认",
        lineupBlocker: null,
        starters: [{ id: "00000000-0000-4000-8000-000000000005", name: "Beta Player", isVetoRepresentative: true, isViewer: false }],
        vetoRepresentativeMemberId: "00000000-0000-4000-8000-000000000005",
        vetoRepresentativeName: "Beta Player",
        startRequested: true,
        isViewerEntryRepresentative: false,
        isViewerVetoRepresentative: false,
        mayEditRepresentative: false,
        mayReassignRepresentative: false,
        mayClaimRepresentative: false,
        mayRequestStart: false,
        mayChooseVetoRole: false,
      },
    ],
    session: {
      revision: 4,
      currentTurnKey: "ban-veto-a-opening",
      currentTurnAction: "ban",
      currentTurnLabel: "BAN",
      currentTurnEntryName: "Alpha",
      currentTurnEntryId: "00000000-0000-4000-8000-000000000002",
      currentTurnMapName: null,
      currentTurnMapLabel: null,
      currentTurnCompleted: 0,
      currentTurnCount: 1,
      currentTurnDurationSeconds: 45,
      turnStartedAt: serverNow,
      turnDeadlineAt: new Date(Date.now() + 60_000).toISOString(),
      serverNow,
      startedAt: serverNow,
      completedAt: null,
      paused: false,
      pauseReason: null,
      mapPool: [{ name: "de_ancient", label: "Ancient" }, { name: "de_anubis", label: "Anubis" }],
      privilegedEntryName: "Beta",
      privilegedEntryId: "00000000-0000-4000-8000-000000000003",
      manualPrivilegedSelectionRequired: false,
      effectiveForceAt: null,
      previousMatchBlocker: false,
      startWindowOpen: true,
    },
    steps: [],
    incidents: [],
    permissions: {
      isAdmin: false,
      viewerEntryId: "00000000-0000-4000-8000-000000000002",
      canOperateCurrentTurn: true,
      canPause: false,
      canResume: false,
      canRewind: false,
      canSetManualPrivilegedEntry: false,
    },
  } as VetoRoomView;
}

describe("VetoRoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits a map choice with the current revision and then uses the returned room snapshot", async () => {
    const room = roomFixture();
    actionMocks.performVetoRoomCommand.mockResolvedValue(ok({ outcome: "applied", room }));
    actionMocks.readVetoRoom.mockResolvedValue(ok(room));

    const user = userEvent.setup();
    render(<VetoRoom initialRoom={room} />);

    await user.click(screen.getByRole("button", { name: "Ancient" }));

    await waitFor(() => expect(actionMocks.performVetoRoomCommand).toHaveBeenCalledWith(expect.objectContaining({
      matchId: room.match.id,
      expectedRevision: room.session.revision,
      expectedTurnKey: room.session.currentTurnKey,
      command: { kind: "step", actionType: "ban", mapName: "de_ancient" },
    })));
    expect(await screen.findByRole("status")).toHaveTextContent("操作已记录。");
    expect(screen.getByRole("heading", { name: /Alpha vs Beta/ })).toBeInTheDocument();
  });

  it("announces the last ten seconds and reconciles once after the deadline settlement", async () => {
    vi.useFakeTimers();
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const room = roomFixture();
    room.session.turnDeadlineAt = new Date(Date.now() + 5_000).toISOString();
    actionMocks.reconcileVetoRoomTimeoutAction.mockResolvedValue(ok({ outcome: "applied", room }));

    try {
      render(<VetoRoom initialRoom={room} />);
      expect(screen.getByText("最后 10 秒，请尽快完成当前操作。")).toHaveAttribute("role", "status");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(7_000);
      });

      expect(actionMocks.reconcileVetoRoomTimeoutAction).toHaveBeenCalledTimes(1);
      expect(actionMocks.reconcileVetoRoomTimeoutAction).toHaveBeenCalledWith({ matchId: room.match.id });
    } finally {
      if (originalDescriptor) Object.defineProperty(document, "visibilityState", originalDescriptor);
      else Reflect.deleteProperty(document, "visibilityState");
      vi.useRealTimers();
    }
  });

  it("requires impact confirmation before an administrator rewinds Veto facts", async () => {
    const room = roomFixture();
    room.permissions.isAdmin = true;
    room.permissions.canRewind = true;
    actionMocks.rewindVetoRoomAction.mockResolvedValue(ok({ outcome: "applied", room }));
    const user = userEvent.setup();
    render(<VetoRoom initialRoom={room} />);

    await user.type(screen.getByLabelText("恢复原因"), "修正错误的回合记录");
    await user.click(screen.getByRole("button", { name: "恢复 BP 步骤" }));
    expect(screen.getByText(/这会移除该回合及之后的 BP 步骤和地图计划/)).toBeInTheDocument();
    expect(actionMocks.rewindVetoRoomAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认恢复" }));
    await waitFor(() => expect(actionMocks.rewindVetoRoomAction).toHaveBeenCalledWith({
      matchId: room.match.id,
      targetTurnKey: "choose-veto-team-a",
      reason: "修正错误的回合记录",
    }));
  });
});
