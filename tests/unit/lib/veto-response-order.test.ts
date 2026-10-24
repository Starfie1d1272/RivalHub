import { expect, it } from "vitest";
import { isCurrentVetoResponse } from "@/lib/matches/veto-room/client";
const room = (revision: number, seconds: number) => ({session:{revision,serverNow:new Date(seconds*1000).toISOString()}});
it("rejects old poll snapshots after commands and admin rewinds, and rejects same-revision clock rollback", () => {
  expect(isCurrentVetoResponse(room(4,10),room(3,20))).toBe(false);
  expect(isCurrentVetoResponse(room(4,10),room(4,9))).toBe(false);
  expect(isCurrentVetoResponse(room(4,10),room(4,11))).toBe(true);
  expect(isCurrentVetoResponse(room(4,10),room(5,9))).toBe(true);
});
