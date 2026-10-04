/** @vitest-environment jsdom */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "@/types/action";
import type { VetoRoomView } from "@/lib/matches/veto-room/read-model";

const actionMocks = vi.hoisted(() => ({
  readVetoRoom: vi.fn(),
  reconcileVetoRoomAction: vi.fn(),
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
        vetoRoleLabel: "先禁图方",
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
        vetoRoleLabel: "后禁图方",
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
    maps: [],
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
    expect(screen.getByTestId("veto-primary-actions")).toHaveClass("sticky", "md:static");
  });

  it("announces the last ten seconds and reconciles once after the deadline settlement", async () => {
    vi.useFakeTimers();
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const room = roomFixture();
    room.session.turnDeadlineAt = new Date(Date.now() + 5_000).toISOString();
    actionMocks.reconcileVetoRoomAction.mockResolvedValue(ok({ outcome: "applied", room }));

    try {
      render(<VetoRoom initialRoom={room} />);
      expect(screen.getByText("最后 10 秒，请完成当前操作。")).toHaveAttribute("role", "status");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(7_000);
      });

      expect(actionMocks.reconcileVetoRoomAction).toHaveBeenCalledTimes(1);
      expect(actionMocks.reconcileVetoRoomAction).toHaveBeenCalledWith({ matchId: room.match.id });
    } finally {
      if (originalDescriptor) Object.defineProperty(document, "visibilityState", originalDescriptor);
      else Reflect.deleteProperty(document, "visibilityState");
      vi.useRealTimers();
    }
  });

  it("reconciles a pre-start force boundary without turning ordinary polling into a mutation", async () => {
    vi.useFakeTimers();
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const room = roomFixture();
    room.match.statusKey = "scheduled";
    room.match.statusLabel = "待进行";
    room.session.currentTurnKey = null;
    room.session.currentTurnAction = null;
    room.session.currentTurnLabel = null;
    room.session.currentTurnEntryName = null;
    room.session.currentTurnEntryId = null;
    room.session.turnStartedAt = null;
    room.session.turnDeadlineAt = null;
    room.session.startedAt = null;
    room.session.effectiveForceAt = new Date(Date.now() + 5_000).toISOString();
    room.permissions.canOperateCurrentTurn = false;
    room.entries[1]!.startRequested = false;
    actionMocks.reconcileVetoRoomAction.mockResolvedValue(ok({ outcome: "applied", room }));
    actionMocks.readVetoRoom.mockResolvedValue(ok(room));

    try {
      render(<VetoRoom initialRoom={room} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(actionMocks.reconcileVetoRoomAction).toHaveBeenCalledTimes(1);
      expect(actionMocks.reconcileVetoRoomAction).toHaveBeenCalledWith({ matchId: room.match.id });
      expect(actionMocks.readVetoRoom).not.toHaveBeenCalled();
    } finally {
      if (originalDescriptor) Object.defineProperty(document, "visibilityState", originalDescriptor);
      else Reflect.deleteProperty(document, "visibilityState");
      vi.useRealTimers();
    }
  });

  it("reconciles immediately when both start requests are already ready after a blocker clears", async () => {
    vi.useFakeTimers();
    const originalDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const room = roomFixture();
    room.match.statusKey = "scheduled";
    room.match.statusLabel = "待进行";
    room.session.currentTurnKey = null;
    room.session.currentTurnAction = null;
    room.session.currentTurnLabel = null;
    room.session.currentTurnEntryName = null;
    room.session.currentTurnEntryId = null;
    room.session.turnStartedAt = null;
    room.session.turnDeadlineAt = null;
    room.session.startedAt = null;
    room.session.effectiveForceAt = new Date(Date.now() + 60_000).toISOString();
    room.session.previousMatchBlocker = false;
    room.permissions.canOperateCurrentTurn = false;
    actionMocks.reconcileVetoRoomAction.mockResolvedValue(ok({ outcome: "applied", room }));

    try {
      render(<VetoRoom initialRoom={room} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(actionMocks.reconcileVetoRoomAction).toHaveBeenCalledTimes(1);
      expect(actionMocks.reconcileVetoRoomAction).toHaveBeenCalledWith({ matchId: room.match.id });
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

    await user.selectOptions(screen.getByLabelText("重做位置"), room.session.currentTurnKey!);
    await user.type(screen.getByLabelText("恢复原因"), "修正错误的回合记录");
    expect(screen.getByRole("option", { name: "从当前「BAN」开始重做" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "恢复 BP 步骤" }));
    expect(screen.getByText(/确认后将清除所选位置及之后的 BP 结果/)).toBeInTheDocument();
    expect(actionMocks.rewindVetoRoomAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "确认恢复" }));
    await waitFor(() => expect(actionMocks.rewindVetoRoomAction).toHaveBeenCalledWith({
      matchId: room.match.id,
      targetTurnKey: room.session.currentTurnKey,
      reason: "修正错误的回合记录",
    }));
  });
  it.each(["spectator", "captain", "admin"])("shows completed BP results with role-specific next steps for %s", role => {
    const room = roomFixture();
    room.session.completedAt = room.session.serverNow;
    room.permissions.isAdmin = role === "admin";
    room.permissions.viewerEntryId = role === "spectator" ? null : room.match.entryAId;
    room.permissions.canOperateCurrentTurn = false;
    room.maps = [{ id: "map-1", mapName: "de_ancient", mapLabel: "Ancient", mapOrder: 1, teamAStartSide: "ct" }];
    actionMocks.readVetoRoom.mockResolvedValue(ok(room));
    render(<VetoRoom initialRoom={room} />);
    expect(screen.getByRole("list", { name: "最终地图顺序与起始阵营" })).toHaveTextContent("Map 1 · Ancient");
    expect(screen.getByText("Alpha · CT")).toBeInTheDocument();
    expect(screen.getByText("Beta · T")).toBeInTheDocument();
    expect(screen.queryByText(/Perfect|建房/)).not.toBeInTheDocument();
    if (role === "admin") {
      expect(screen.getByRole("link", { name: "返回比赛工作台" })).toHaveAttribute("href", `/admin/rivals/matches/${room.match.id}`);
    } else {
      expect(screen.queryByText(/Perfect|工作台|建房/)).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "返回比赛" })).toHaveAttribute("href", `/rivals/matches/${room.match.id}`);
      expect(screen.queryByLabelText("恢复原因")).not.toBeInTheDocument();
    }
  });

  it("shows spectators a neutral deadline and preserves actions for the acting representative", () => {
    const room = roomFixture();
    room.permissions.canOperateCurrentTurn = false;
    room.permissions.viewerEntryId = null;
    room.session.turnDeadlineAt = new Date(new Date(room.session.serverNow).getTime() + 5_000).toISOString();
    actionMocks.readVetoRoom.mockResolvedValue(ok(room));
    render(<VetoRoom initialRoom={room} />);
    expect(screen.getByText("本轮操作剩余 10 秒。")).toBeInTheDocument();
    expect(screen.queryByText(/请完成当前操作/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("veto-primary-actions")).not.toBeInTheDocument();
  });

  it("keeps cancelled BP history without a live countdown or commands", () => {
    const room = roomFixture();
    room.match.statusKey = "cancelled";
    room.match.statusLabel = "已取消";
    actionMocks.readVetoRoom.mockResolvedValue(ok(room));
    render(<VetoRoom initialRoom={room} />);
    expect(screen.getByText("比赛已取消")).toBeInTheDocument();
    expect(screen.queryByText("本次操作剩余时间")).not.toBeInTheDocument();
    expect(screen.queryByTestId("veto-primary-actions")).not.toBeInTheDocument();
    expect(actionMocks.reconcileVetoRoomAction).not.toHaveBeenCalled();
  });

  it("acknowledges an explicit refresh while keeping background reads quiet", async () => {
    const room = roomFixture();
    actionMocks.readVetoRoom.mockResolvedValue(ok(room));
    render(<VetoRoom initialRoom={room} />);
    expect(screen.queryByText("BP 信息已更新。")).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "更新 BP 信息" }));
    expect(await screen.findByText("BP 信息已更新。")).toBeInTheDocument();
  });

  it("keeps the responsible team's historical appeal available on demand after cancellation", async () => {
    const room = roomFixture();
    room.match.statusKey = "cancelled";
    room.match.statusLabel = "已取消";
    room.permissions.canOperateCurrentTurn = false;
    room.incidents = [{ id: "incident-1", entryName: "Alpha", selected: ["Ancient"], sourceLabel: "超时自动选择", appeal: null, mayAppeal: true }];
    actionMocks.readVetoRoom.mockResolvedValue(ok(room));
    render(<VetoRoom initialRoom={room} />);
    expect(screen.getByRole("button", { name: "提交申诉" })).not.toBeVisible();
    await userEvent.setup().click(screen.getByText("对本条超时提出申诉"));
    expect(screen.getByLabelText("申诉原因")).toBeVisible();
    expect(screen.getByRole("button", { name: "提交申诉" })).toBeDisabled();
    expect(screen.queryByTestId("veto-primary-actions")).not.toBeInTheDocument();
  });

});

 it("keeps common BP terms concise and explains the current action on demand", async () => {
    const user = userEvent.setup();
    render(<VetoRoom initialRoom={roomFixture()} />);
    expect(screen.getByText("BAN", { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "当前 BP 操作说明" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("禁用地图，将其移出本场可选地图池。");
 });
