import { desc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AdminSidebar } from "@/components/admin/AdminSidebar";

// The admin tree is authenticated and intentionally blocking; it must not be
// queried during a production build without a request/session context.
export const instant = false;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await connection();
  const session = await resolveAdminPageAccess(requireAdmin);
  if (!session) return <AdminAccessDenied />;
  const seasonOptions = await db.select({
    id: seasons.id, slug: seasons.slug, name: seasons.name, competitionTemplate: seasons.competitionTemplate,
    hasCaptainVoting: seasons.hasCaptainVoting, hasDraft: seasons.hasDraft, hasCommunityAwards: seasons.hasCommunityAwards,
  }).from(seasons).where(session.role === "super_admin" ? undefined : inArray(seasons.id, session.seasonIds)).orderBy(desc(seasons.createdAt));
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[224px_minmax(0,1fr)]">
      <AdminSidebar seasons={seasonOptions} email={session.email} role={session.role === "super_admin" ? "super_admin" : "season_admin"} />
      <main className="min-w-0">{children}</main>
    </div>
  );
}
