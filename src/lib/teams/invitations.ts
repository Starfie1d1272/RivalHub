import { and, eq, lte } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { teamInvitations } from "@/db/schema";

/**
 * Canonical expiration transition for pending team invitations.
 *
 * Expiration is a system-time fact, not a user response: the transition only
 * flips `status` to `expired` and leaves `respondedAt` / `respondedByUserId`
 * untouched. Persisting it releases the one-pending-direct-invite-per-(team,
 * user) identity so the captain can re-invite the same person without hitting
 * the partial unique index with a row the UI no longer shows.
 */
export async function expirePendingInvitationsInTx(
  tx: TxDb,
  where: { invitationId?: string; teamId?: string; invitedUserId?: string },
): Promise<number> {
  const conditions = [eq(teamInvitations.status, "pending"), lte(teamInvitations.expiresAt, new Date())];
  if (where.invitationId) conditions.push(eq(teamInvitations.id, where.invitationId));
  if (where.teamId) conditions.push(eq(teamInvitations.teamId, where.teamId));
  if (where.invitedUserId) conditions.push(eq(teamInvitations.invitedUserId, where.invitedUserId));
  const expired = await tx.update(teamInvitations)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: teamInvitations.id });
  return expired.length;
}
