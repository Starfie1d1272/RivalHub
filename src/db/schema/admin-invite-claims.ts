import { pgTable, uuid, timestamp, unique, index } from "drizzle-orm/pg-core";
import { adminInvites } from "./admin-invites";
import { users } from "./users";

/** Immutable per-user claims replace the legacy invite counters and username array. */
export const adminInviteClaims = pgTable("admin_invite_claims", {
  inviteId: uuid("invite_id").notNull().references(() => adminInvites.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  inviteUserUnique: unique("admin_invite_claims_invite_user_unique").on(t.inviteId, t.userId),
  inviteIdIndex: index("admin_invite_claims_invite_id_idx").on(t.inviteId),
  userIdIndex: index("admin_invite_claims_user_id_idx").on(t.userId),
}));

export type AdminInviteClaim = typeof adminInviteClaims.$inferSelect;
export type NewAdminInviteClaim = typeof adminInviteClaims.$inferInsert;
