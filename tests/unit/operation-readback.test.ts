import { expect, it } from "vitest";
import { recordingReadbackVersion, rosterReadbackVersion, timeReadbackVersion } from "@/lib/matches/operation-readback";
import { projectRecordingCommand } from "@/lib/postmatch/recording-projection";

it("versions starter/substitute/representative semantics without depending on SQL row order", async () => {
  const value = { status: "submitted", starterIds: ["a", "b"], substituteIds: ["c"], vetoRepresentativeEventRosterMemberId: "a" };
  const version = await rosterReadbackVersion("match", value);
  expect(version).toMatch(/^[a-f0-9]{64}$/);
  expect(await rosterReadbackVersion("match", { ...value, starterIds: ["b", "a"] })).toBe(version);
  for (const changed of [{ starterIds: ["a", "d"] }, { substituteIds: [] }, { vetoRepresentativeEventRosterMemberId: "b" }, { status: "confirmed" }]) {
    expect(await rosterReadbackVersion("match", { ...value, ...changed })).not.toBe(version);
  }
});
it("shares canonical recording content and relative order, preserving other groups", async () => {
  const values = [
    { id: "a", commentatorUserId: "one", title: "First", url: "https://example.test/1" },
    { id: "b", commentatorUserId: "two", title: "Other", url: "https://example.test/2" },
    { id: "c", commentatorUserId: "one", title: "Last", url: "https://example.test/3" },
  ];
  const projected = projectRecordingCommand(values, { kind: "move", id: "c", direction: "up" });
  expect(projected.map(row => row.id)).toEqual(["c", "b", "a"]);
  expect(values.map(row => row.id)).toEqual(["a", "b", "c"]);
  const version = await recordingReadbackVersion("match", projected);
  expect(await recordingReadbackVersion("match", values)).not.toBe(version);
  expect(await recordingReadbackVersion("match", projected.map(row => row.id === "c" ? { ...row, url: "https://example.test/new" } : row))).not.toBe(version);
});
it("does not confirm a proposal merely because the scheduled time is equal", async () => {
  const value = { proposalId: "original", status: "accepted", resolution: "participant_accept", proposedTime: "2026-10-25T10:00:00.000Z", scheduledAt: "2026-10-25T10:00:00.000Z", rejectReason: null };
  const version = await timeReadbackVersion("match", value);
  for (const changed of [{ proposalId: "another" }, { status: "pending" }, { resolution: "auto_timeout" }, { scheduledAt: null }]) {
    expect(await timeReadbackVersion("match", { ...value, ...changed })).not.toBe(version);
  }
});
