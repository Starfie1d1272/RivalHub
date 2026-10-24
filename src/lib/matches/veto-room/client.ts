import type { ActionResult } from "@/types/action";
import type { VetoRoomView } from "./read-model";

/** Independent HTTP requests keep refreshes out of the Server Action queue. */
export async function fetchVetoRoom(matchId: string, signal: AbortSignal): Promise<ActionResult<VetoRoomView>> {
  const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}/veto-room`, { credentials: "same-origin", cache: "no-store", signal });
  return response.json();
}

export async function sendVetoInteraction(operation: "start" | "command" | "reconcile", input: unknown): Promise<ActionResult<{ outcome: string; room: VetoRoomView }>> {
  const data = input as { matchId: string };
  const response = await fetch(`/api/matches/${encodeURIComponent(data.matchId)}/veto-room`, {
    method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, operation }), signal: AbortSignal.timeout(20000),
  });
  return response.json();
}

/** A slow read must not roll back a committed command or an administrator rewind. */
export function isCurrentVetoResponse(current: { session: { revision: number; serverNow: string } }, next: { session: { revision: number; serverNow: string } }) {
  return next.session.revision > current.session.revision || (next.session.revision === current.session.revision &&
    new Date(next.session.serverNow).getTime() >= new Date(current.session.serverNow).getTime());
}
