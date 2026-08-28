import { and, eq, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { auditLogs, users } from "@/db/schema";
import { normalizeEmail } from "@/lib/utils/email";

const OWNER_BOOTSTRAP_LOCK_KEY = "rivalhub.owner.bootstrap";

export function getConfiguredOwnerEmail(): string | null {
  const rawEmail = process.env.RIVALHUB_OWNER_EMAIL?.trim();
  if (!rawEmail) return null;

  const email = normalizeEmail(rawEmail);
  if (!email.includes("@")) {
    throw new Error("RIVALHUB_OWNER_EMAIL must be a valid email address");
  }
  return email;
}

/**
 * Promote the configured first owner inside the same transaction as the
 * authenticated user's public account upsert.
 *
 * The transaction-scoped advisory lock is required because a missing
 * super_admin row cannot itself provide a row lock. Once any super_admin
 * exists, this path is permanently inactive for future logins.
 */
export async function bootstrapConfiguredOwnerInTx(
  tx: TxDb,
  user: typeof users.$inferSelect,
): Promise<typeof users.$inferSelect> {
  const ownerEmail = getConfiguredOwnerEmail();
  if (!ownerEmail || normalizeEmail(user.email) !== ownerEmail) return user;

  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${OWNER_BOOTSTRAP_LOCK_KEY}))`);

  const existingSuperAdmins = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "super_admin"))
    .for("update");
  if (existingSuperAdmins.length > 0) return user;

  const [promoted] = await tx
    .update(users)
    .set({ role: "super_admin", updatedAt: new Date() })
    .where(and(eq(users.id, user.id), eq(users.email, ownerEmail)))
    .returning();
  if (!promoted) return user;

  await tx.insert(auditLogs).values({
    seasonId: null,
    action: "user.owner_bootstrap",
    actorId: user.id,
    targetId: user.id,
    targetType: "user",
    meta: { email: ownerEmail, role: "super_admin", reason: "configured_owner_email" },
  });

  return promoted;
}
