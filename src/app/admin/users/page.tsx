import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { adminUsers } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth/session";
import { Marker } from "@/components/rivalhub";
import { AdminUserList } from "@/components/admin/AdminUserList";

export default async function AdminUsersPage() {
  let admin;
  try {
    admin = await requireSuperAdmin();
  } catch {
    redirect("/admin/login");
  }

  const rows = await db
    .select()
    .from(adminUsers)
    .orderBy(adminUsers.createdAt);

  const users = rows.map((u) => ({
    ...u,
    createdAt: u.createdAt?.toISOString() ?? "",
    updatedAt: u.updatedAt?.toISOString() ?? "",
  }));

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <Marker>管理员列表</Marker>
      <AdminUserList
        users={users}
        currentAdminId={admin.authSource === "root" ? admin.legacyAdminId : undefined}
      />
    </div>
  );
}
