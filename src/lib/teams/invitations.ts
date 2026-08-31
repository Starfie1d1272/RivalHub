import { and, eq, isNull, lte, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { auditLogs, teamInvitations, teamMemberships, teams } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

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

export type AcceptTeamInvitationOutcome =
  | { kind: "expired" }
  | { kind: "accepted"; teamId: string; slug: string };

/**
 * Canonical accept-invitation transition. The expired case persists the
 * expired status inside the caller's transaction and returns a tagged outcome
 * instead of throwing — writing then throwing in the same callback would roll
 * the transition back. The action converts the outcome into the business
 * failure after the transaction has committed.
 */
export async function acceptTeamInvitationInTx(
  tx: TxDb,
  input: { userId: string; actorId: string; invitationId?: string; tokenHash?: string },
): Promise<AcceptTeamInvitationOutcome> {
  await tx.execute(sql`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`);
  const [invitation] = input.invitationId
    ? await tx.select().from(teamInvitations).where(eq(teamInvitations.id, input.invitationId)).for("update")
    : await tx.select().from(teamInvitations).where(eq(teamInvitations.tokenHash, input.tokenHash!)).for("update");
  if (!invitation || invitation.status !== "pending") throw new AppError(ErrorCode.NOT_FOUND, "邀请不存在或已失效。");
  if (invitation.kind === "direct" && invitation.invitedUserId !== input.userId) throw new AppError(ErrorCode.FORBIDDEN, "该邀请不属于你。");
  if (invitation.expiresAt <= new Date()) {
    await expirePendingInvitationsInTx(tx, { invitationId: invitation.id });
    return { kind: "expired" };
  }
  const [team] = await tx.select().from(teams).where(eq(teams.id, invitation.teamId)).for("update");
  if (!team) throw new AppError(ErrorCode.NOT_FOUND, "队伍不存在。");
  if (team.status !== "active") throw new AppError(ErrorCode.VALIDATION_FAILED, "队伍已解散。");
  const active = await tx.query.teamMemberships.findFirst({ where: and(eq(teamMemberships.userId, input.userId), eq(teamMemberships.status, "active"), isNull(teamMemberships.endedAt)) });
  if (active) throw new AppError(ErrorCode.VALIDATION_FAILED, "你已在另一支长期队伍中处于 active。");
  const sameCurrent = await tx.query.teamMemberships.findFirst({ where: and(eq(teamMemberships.teamId, team.id), eq(teamMemberships.userId, input.userId), isNull(teamMemberships.endedAt)) });
  if (sameCurrent) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "你当前已属于这支队伍。");
  await tx.insert(teamMemberships).values({ teamId: team.id, userId: input.userId, status: "active", role: "member", invitedByUserId: invitation.invitedByUserId });
  await tx.update(teamInvitations).set({ status: "accepted", respondedByUserId: input.userId, respondedAt: new Date(), updatedAt: new Date() }).where(eq(teamInvitations.id, invitation.id));
  await tx.insert(auditLogs).values({ seasonId: null, action: "team.invite.accept", actorId: input.actorId, targetId: team.id, targetType: "team", meta: { invitationId: invitation.id, userId: input.userId } });
  return { kind: "accepted", teamId: team.id, slug: team.slug };
}
