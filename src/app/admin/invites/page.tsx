import { redirect } from "next/navigation";
import { asc, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { adminInvites, seasons } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth/session";
import { AdminNav } from "@/components/admin/AdminNav";
import { InviteManager } from "@/components/admin/InviteManager";

export default async function AdminInvitesPage() {
  let admin;
  try {
    admin = await requireSuperAdmin();
  } catch {
    redirect("/admin/login");
  }

  const [rows, seasonRows] = await Promise.all([
    db
      .select()
      .from(adminInvites)
      .orderBy(desc(adminInvites.createdAt))
      .limit(50),
    db
      .select({
        id: seasons.id,
        name: seasons.name,
        slug: seasons.slug,
      })
      .from(seasons)
      .orderBy(asc(seasons.createdAt)),
  ]);

  const invites = rows.map((r) => ({
    ...r,
    usedByUsernames: r.usedByUsernames ?? [],
    expiresAt: r.expiresAt?.toISOString() ?? null,
    createdAt: r.createdAt?.toISOString() ?? "",
  }));

  return (
    <div className="min-h-screen">
      <AdminNav email={admin.email} />

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="text-2xl font-bold mb-6">邀请码管理</h1>
        <InviteManager invites={invites} seasons={seasonRows} />
      </div>
    </div>
  );
}
