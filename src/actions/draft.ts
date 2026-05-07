"use server";

// TODO: captain picks a player — Postgres transaction + SELECT FOR UPDATE + idempotency key
// client_request_id provides idempotency against double-submit
export async function pickPlayer(
  _teamId: string,
  _registrationId: string,
  _clientRequestId: string
): Promise<void> {
  throw new Error("not implemented");
}

// TODO: admin triggers auto-pick (by peak_rating desc) when timer expires
// Also called by Vercel Cron route
export async function autoPick(_seasonId: string): Promise<void> {
  throw new Error("not implemented");
}
