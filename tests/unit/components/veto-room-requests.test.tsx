import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { VetoRoomView } from "@/lib/matches/veto-room/read-model";
const read = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/matches/veto-room/client", async original => ({ ...await original<typeof import("@/lib/matches/veto-room/client")>(), fetchVetoRoom: read, sendVetoInteraction: send }));
vi.mock("@/components/telemetry/ContentReady", () => ({ ContentReady: () => null }));
vi.mock("@/lib/telemetry/client", () => ({ observeAction: (_name: string, action: unknown) => action }));
vi.mock("@/actions/matches/veto-room", () => ({
  claimVetoRepresentativeAction: vi.fn(), pauseVetoRoomAction: vi.fn(), resolveVetoRoomAppeal: vi.fn(), resumeVetoRoomAction: vi.fn(),
  rewindVetoRoomAction: vi.fn(), setManualVetoPrivilege: vi.fn(), submitVetoRoomAppeal: vi.fn(), updateVetoRepresentative: vi.fn(),
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
afterEach(()=>{cleanup();vi.useRealTimers();vi.clearAllMocks();});
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
});
