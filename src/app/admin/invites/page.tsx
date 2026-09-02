import { asc, count, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { adminInviteClaims, adminInvites, seasons } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { Marker } from "@/components/rivalhub";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { InviteManager } from "@/components/admin/InviteManager";

export default async function AdminInvitesPage() {
  if (!(await resolveAdminPageAccess(requireSuperAdmin))) return <AdminAccessDenied />;

  const [rows, claimCounts, seasonRows] = await Promise.all([
    db
      .select()
      .from(adminInvites)
      .orderBy(desc(adminInvites.createdAt))
      .limit(50),
    db
      .select({ inviteId: adminInviteClaims.inviteId, claimCount: count() })
      .from(adminInviteClaims)
      .groupBy(adminInviteClaims.inviteId),
    db
      .select({
        id: seasons.id,
        name: seasons.name,
        slug: seasons.slug,
      })
      .from(seasons)
      .orderBy(asc(seasons.createdAt)),
  ]);

  const claimCountByInviteId = new Map(
    claimCounts.map((row) => [row.inviteId, Number(row.claimCount)]),
  );
  const invites = rows.map((r) => ({
    ...r,
    claimCount: claimCountByInviteId.get(r.id) ?? 0,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    createdAt: r.createdAt?.toISOString() ?? "",
  }));

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <Marker>邀请码管理</Marker>
      <InviteManager invites={invites} seasons={seasonRows} />
    </div>
  );
}
