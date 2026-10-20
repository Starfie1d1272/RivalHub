import { expect, it } from "vitest";
import { selectCompetitionEntryParticipantContext } from "@/lib/competition-entries/participant-context";

it("opens only a current personal invitation while keeping the existing commitment available for explicit transfer", () => {
  const old = { id: "old", name: "原队", updatedAt: new Date(0) };
  const invited = { id: "new", name: "新队", updatedAt: new Date(1) };
  const expired = { id: "expired", name: "历史邀请", updatedAt: new Date(2) };
  const input = { activeClaimEntries: [old], representativeEntries: [], participantRows: [{ entry: invited, participantStatus: "invited" as const }, { entry: expired, participantStatus: null }] };
  const selected = selectCompetitionEntryParticipantContext({ ...input, requestedEntryId: invited.id });
  expect(selected.primaryEntry).toEqual(invited);
  expect(selected.activeClaimEntry).toEqual(old);
  expect(selected.pendingInvitations).toEqual([{ id: invited.id, name: invited.name }]);
  for (const requestedEntryId of ["unrelated", expired.id]) {
    expect(selectCompetitionEntryParticipantContext({ ...input, requestedEntryId }).primaryEntry).toEqual(old);
  }
});
