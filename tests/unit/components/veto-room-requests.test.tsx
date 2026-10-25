import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { VetoRoomView } from "@/lib/matches/veto-room/read-model";
const read = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
const appealSubmit = vi.hoisted(() => vi.fn());
const appealResolve = vi.hoisted(() => vi.fn());
const beginTask = vi.hoisted(() => vi.fn(() => "captured-veto-attempt"));
const completeTask = vi.hoisted(() => vi.fn());
const stepTask = vi.hoisted(() => vi.fn());
vi.mock("@/lib/matches/veto-room/client", async original => ({ ...await original<typeof import("@/lib/matches/veto-room/client")>(), fetchVetoRoom: read, sendVetoInteraction: send }));
vi.mock("@/components/telemetry/ContentReady", () => ({ ContentReady: () => null }));
vi.mock("@/lib/telemetry/client", async original => ({ ...await original<typeof import("@/lib/telemetry/client")>(), observeAction: (_name: string, action: unknown) => action, beginTelemetryTask: beginTask, completeTelemetryTask: completeTask, stepTelemetryTask: stepTask }));
vi.mock("@/actions/matches/veto-room", () => ({
  claimVetoRepresentativeAction: vi.fn(), pauseVetoRoomAction: vi.fn(), resolveVetoRoomAppeal: appealResolve, resumeVetoRoomAction: vi.fn(),
  rewindVetoRoomAction: vi.fn(), setManualVetoPrivilege: vi.fn(), submitVetoRoomAppeal: appealSubmit, updateVetoRepresentative: vi.fn(),
}));
import { VetoRoom } from "@/components/matches/VetoRoom";
const now = "2026-10-24T12:00:00.000Z";
function room(revision: number): VetoRoomView {
  return {
    seasonSlug:"fixture",seasonName:"Fixture",
    match:{id:"match-1",stage:"Stage 1",format:"BO3",formatKey:"bo3",statusKey:"in_progress",statusLabel:"进行中",scheduledAt:null,entryAId:"a",entryBId:"b"},
    entries:["a","b"].map(id=>({id,name:id.toUpperCase(),starters:[],vetoRepresentativeMemberId:null,vetoRepresentativeName:null})),
    session:{revision,currentTurnKey:revision===1?"choose-veto-team-a":"ban-veto-a-opening",currentTurnAction:revision===1?"role_select":"ban",currentTurnEntryId:"a",currentTurnCount:1,currentTurnCompleted:0,
      startedAt:now,completedAt:null,paused:false,serverNow:now,turnDeadlineAt:"2026-10-24T12:00:45.000Z",privilegedEntryId:"a",mapPool:[{name:"de_nuke",label:"Nuke"}]},
    maps:[],steps:[],incidents:[],permissions:{canOperateCurrentTurn:true,isAdmin:false},
  } as unknown as VetoRoomView;
}
afterEach(()=>{cleanup();vi.useRealTimers();vi.clearAllMocks();stepTask.mockReset();});
it("submits while a poll is pending and ignores its late old room after the command commits", async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);
  Object.defineProperty(document,"visibilityState",{value:"visible",configurable:true});
  let finishRead!: (value: unknown)=>void;
  read.mockImplementation(()=>new Promise(resolve=>{finishRead=resolve;}));
  send.mockResolvedValue({success:true,data:{outcome:"applied",room:room(2)}});
  render(<VetoRoom initialRoom={room(1)}/>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(2000);});
  expect(read).toHaveBeenCalledOnce();
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"由 A 先禁图"}));});
  expect(send).toHaveBeenCalledWith("command",expect.objectContaining({expectedRevision:1,command:{kind:"role_select",entryId:"a"}}));
  expect(screen.queryByRole("button",{name:"由 A 先禁图"})).not.toBeInTheDocument();
  await act(async()=>{finishRead({success:true,data:room(1)});});
  expect(screen.queryByRole("button",{name:"由 A 先禁图"})).not.toBeInTheDocument();
});


it("retries a failed deadline reconcile without waiting for cron and stops while hidden", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  const overdue = room(1);
  overdue.session.turnDeadlineAt = "2026-10-24T11:59:57.000Z";
  read.mockResolvedValue({ success: true, data: overdue });
  send.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ success: true, data: { outcome: "applied", room: room(2) } });
  render(<VetoRoom initialRoom={overdue} />);
  for (let tick = 0; tick < 8; tick++) await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls.every(call => call[0] === "reconcile")).toBe(true);
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(60_000); });
  expect(send).toHaveBeenCalledTimes(2);
});

it("immediately reads an unknown command result and blocks resubmission of the old revision", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  read.mockResolvedValue({ success: true, data: room(1) });
  send.mockRejectedValueOnce(new Error("response lost after commit"));
  render(<VetoRoom initialRoom={room(1)} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  const before = read.mock.calls.length;
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "由 A 先禁图" })); });
  expect(read.mock.calls.length).toBeGreaterThan(before);
  expect(screen.getByRole("button", { name: "由 A 先禁图" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "由 A 先禁图" }));
  expect(send).toHaveBeenCalledOnce();
  read.mockResolvedValue({ success: true, data: room(2) });
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(screen.queryByRole("button", { name: "由 A 先禁图" })).not.toBeInTheDocument();
  expect(send).toHaveBeenCalledOnce();
  expect(completeTask).not.toHaveBeenCalled();
  expect(stepTask).not.toHaveBeenCalled();
});

it("keeps a confirmed commit distinct from a failed room refresh and waits for its committed revision", async () => {
  stepTask.mockImplementation(() => { expect(screen.queryByRole("button", { name: "由 A 先禁图" })).not.toBeInTheDocument(); });
  vi.useFakeTimers(); vi.setSystemTime(now);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  read.mockResolvedValue({ success: true, data: room(1) });
  send.mockResolvedValue({ success: true, data: { outcome: "applied", receipt: { committedRevision: 2 }, room: null, refreshFailed: true } });
  render(<VetoRoom initialRoom={room(1)} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "由 A 先禁图" })); });
  expect(completeTask).toHaveBeenCalledWith("veto", "captured-veto-attempt");
  expect(stepTask).not.toHaveBeenCalled();
  expect(screen.getByText("操作已确认，房间刷新暂未完成，正在重新同步。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "由 A 先禁图" })).toBeDisabled();
  read.mockResolvedValue({ success: true, data: room(2) });
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(screen.queryByRole("button", { name: "由 A 先禁图" })).not.toBeInTheDocument();
  expect(send).toHaveBeenCalledOnce();
  expect(completeTask).toHaveBeenCalledTimes(1);
  expect(stepTask).toHaveBeenCalledWith("veto", "result", "captured-veto-attempt");
  expect(completeTask.mock.invocationCallOrder[0]).toBeLessThan(stepTask.mock.invocationCallOrder[0]!);
});

it.each(["lost", "internal", "committed-refresh-failed"] as const)("confirms a same-revision appeal submission after %s without replay", async fault => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  const initial = room(1);
  initial.session.paused = true;
  initial.permissions.isAdmin = true; initial.permissions.canResume = true;
  initial.incidents = [{ id: "incident-1", entryId: "a", entryName: "A", selected: [], selectedEntities: [], sourceLabel: "超时自动选择", appeal: null, mayAppeal: true }];
  read.mockResolvedValue({ success: true, data: initial });
  if (fault === "lost") appealSubmit.mockRejectedValueOnce(new Error("response lost"));
  else if (fault === "internal") appealSubmit.mockResolvedValueOnce({ success: false, error: { code: "INTERNAL_ERROR", message: "projection unavailable" } });
  else appealSubmit.mockResolvedValueOnce({ success: true, data: { outcome: "applied", room: null, refreshFailed: true } });
  render(<VetoRoom initialRoom={initial} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  fireEvent.change(screen.getByLabelText("申诉原因"), { target: { value: "fixture appeal reason" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "提交申诉" })); });
  expect(screen.getByRole("button", { name: "继续 BP" })).toBeDisabled();
  const restored = structuredClone(initial);
  restored.incidents[0]!.mayAppeal = false;
  restored.incidents[0]!.appeal = { id: "appeal-1", status: "pending", statusLabel: "待裁定", submittedByViewer: true, resolvedByViewer: false, resolutionScope: null, reason: "fixture appeal reason", resolutionNote: null, mayResolve: true };
  read.mockResolvedValue({ success: true, data: restored });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "更新 BP 信息" })); });
  expect(screen.getByRole("button", { name: "继续 BP" })).toBeEnabled();
  expect(screen.getByText("申诉：fixture appeal reason")).toBeInTheDocument();
  expect(appealSubmit).toHaveBeenCalledOnce();
  expect(completeTask).toHaveBeenCalledWith("veto", "captured-veto-attempt");
  expect(stepTask).toHaveBeenCalledWith("veto", "result", "captured-veto-attempt");
});

it.each(["lost", "internal", "committed-refresh-failed"] as const)("confirms a same-revision rejected resolution after %s without replay", async fault => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  const initial = room(1);
  initial.session.paused = true;
  initial.permissions.isAdmin = true; initial.permissions.canResume = true;
  initial.incidents = [{ id: "incident-1", entryId: "a", entryName: "A", selected: [], selectedEntities: [], sourceLabel: "超时自动选择", mayAppeal: false,
    appeal: { id: "appeal-1", status: "pending", statusLabel: "待裁定", submittedByViewer: true, resolvedByViewer: false, resolutionScope: null, reason: "fixture reason", resolutionNote: null, mayResolve: true } }];
  read.mockResolvedValue({ success: true, data: initial });
  if (fault === "lost") appealResolve.mockRejectedValueOnce(new Error("response lost"));
  else if (fault === "internal") appealResolve.mockResolvedValueOnce({ success: false, error: { code: "INTERNAL_ERROR", message: "projection unavailable" } });
  else appealResolve.mockResolvedValueOnce({ success: true, data: { outcome: "applied", room: null, refreshFailed: true } });
  render(<VetoRoom initialRoom={initial} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  fireEvent.change(screen.getByLabelText("处理说明"), { target: { value: "fixture decision note" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "结束申诉（不恢复 BP）" })); });
  expect(screen.getByRole("button", { name: "继续 BP" })).toBeDisabled();
  const restored = structuredClone(initial);
  restored.incidents[0]!.appeal = { ...restored.incidents[0]!.appeal!, status: "rejected", statusLabel: "已驳回", resolvedByViewer: true,
    resolutionScope: "participant_or_unverified", resolutionNote: "fixture decision note", mayResolve: false };
  read.mockResolvedValue({ success: true, data: restored });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "更新 BP 信息" })); });
  expect(screen.getByRole("button", { name: "继续 BP" })).toBeEnabled();
  expect(screen.getByText("已驳回")).toBeInTheDocument();
  expect(appealResolve).toHaveBeenCalledOnce();
  expect(completeTask).toHaveBeenCalledWith("veto", "captured-veto-attempt");
  expect(stepTask).toHaveBeenCalledWith("veto", "result", "captured-veto-attempt");
});

it("retries durable invalidation via reconcile while a room is paused, without replaying a user command", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  const initial = room(1); initial.session.paused = true; initial.pendingInvalidation = true;
  const restored = structuredClone(initial); restored.pendingInvalidation = false;
  read.mockResolvedValue({ success: true, data: initial });
  send.mockResolvedValueOnce({ success: true, data: { outcome: "idempotent", room: initial, postCommit: { invalidation: "pending", projection: "complete" } } })
    .mockResolvedValue({ success: true, data: { outcome: "idempotent", room: restored, postCommit: { invalidation: "complete", projection: "complete" } } });
  render(<VetoRoom initialRoom={initial} />);
  for (let tick = 0; tick < 8; tick++) await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls.every(call => call[0] === "reconcile")).toBe(true);
});


it("immediately resynchronizes a persisted pageshow without replaying a mutation", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  const initial = room(1); initial.session.paused = true;
  read.mockResolvedValue({ success: true, data: initial });
  render(<VetoRoom initialRoom={initial} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  const reads = read.mock.calls.length;
  const restored = new Event("pageshow"); Object.defineProperty(restored, "persisted", { value: true });
  await act(async () => { window.dispatchEvent(restored); });
  expect(read.mock.calls.length).toBe(reads + 1);
  expect(send).not.toHaveBeenCalled();
});


it("does not complete a stale command after its room is recovered", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  read.mockResolvedValue({ success: true, data: room(1) });
  send.mockResolvedValue({ success: true, data: { outcome: "stale", receipt: { committedRevision: 2 }, room: null } });
  render(<VetoRoom initialRoom={room(1)} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "由 A 先禁图" })); });
  read.mockResolvedValue({ success: true, data: room(2) });
  await act(async () => { await vi.advanceTimersByTimeAsync(2500); });
  expect(send).toHaveBeenCalledOnce();
  expect(completeTask).not.toHaveBeenCalled();
  expect(stepTask).not.toHaveBeenCalled();
});
