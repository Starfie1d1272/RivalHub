import type { ActionResult } from "@/types/action";
import type { VetoRoomView } from "./read-model";
import type { VetoMutationReceipt } from "./service";

export type VetoInteractionResponse = { outcome: string; room: VetoRoomView | null; receipt?: VetoMutationReceipt; refreshFailed?: boolean; postCommit?: { invalidation: "complete" | "pending"; projection: "complete" | "pending" } };

export type VetoRecoveryFact =
  | { kind: "appeal_submit"; incidentId: string; reason: string; previousAppealId: string | null }
  | { kind: "appeal_resolve"; appealId: string; scope: "platform_or_organizer" | "participant_or_unverified"; note: string };

/** Authorized response facts can confirm writes which do not change session revision. */
export function hasVetoRecoveryFact(room: VetoRoomView, fact: VetoRecoveryFact): boolean {
  if (fact.kind === "appeal_submit") {
    const appeal = room.incidents.find(incident => incident.id === fact.incidentId)?.appeal;
    return Boolean(appeal && appeal.id !== fact.previousAppealId && appeal.submittedByViewer && appeal.reason === fact.reason);
  }
  const appeal = room.incidents.find(incident => incident.appeal?.id === fact.appealId)?.appeal;
  return Boolean(appeal && appeal.resolvedByViewer && appeal.resolutionScope === fact.scope && appeal.resolutionNote === fact.note
    && appeal.status === (fact.scope === "platform_or_organizer" ? "accepted" : "rejected"));
}

// Request duration is an uncertainty bound, not an assumption of symmetric RTT.
// It stays local to this response and never becomes a server admission time.
const responseDurations = new WeakMap<VetoRoomView, number>();
export function vetoClockUpperBound(room: VetoRoomView): number {
  return new Date(room.session.serverNow).getTime() + (responseDurations.get(room) ?? 0);
}

/** Independent HTTP requests keep refreshes out of the Server Action queue. */
export async function fetchVetoRoom(matchId: string, signal: AbortSignal): Promise<ActionResult<VetoRoomView>> {
  const sentAt = performance.now();
  const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}/veto-room`, { credentials: "same-origin", cache: "no-store", signal });
  const result: ActionResult<VetoRoomView> = await response.json();
  if (result.success) responseDurations.set(result.data, performance.now() - sentAt);
  return result;
}

export async function sendVetoInteraction(operation: "start" | "command" | "reconcile", input: unknown): Promise<ActionResult<VetoInteractionResponse>> {
  const sentAt = performance.now();
  const data = input as { matchId: string };
  const response = await fetch(`/api/matches/${encodeURIComponent(data.matchId)}/veto-room`, {
    method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, operation }), signal: AbortSignal.timeout(20000),
  });
  const result: ActionResult<VetoInteractionResponse> = await response.json();
  if (result.success && result.data.room) responseDurations.set(result.data.room, performance.now() - sentAt);
  return result;
}

/** A slow read must not roll back a committed command or an administrator rewind. */
export function isCurrentVetoResponse(current: { session: { revision: number; serverNow: string } }, next: { session: { revision: number; serverNow: string } }) {
  return next.session.revision > current.session.revision || (next.session.revision === current.session.revision &&
    new Date(next.session.serverNow).getTime() >= new Date(current.session.serverNow).getTime());
}
