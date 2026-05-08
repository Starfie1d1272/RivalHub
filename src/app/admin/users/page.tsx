import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { adminUsers } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth/session";
import { AdminNav } from "@/components/admin/AdminNav";
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
    <div className="min-h-screen">
      <AdminNav email={admin.email} />

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="text-2xl font-bold mb-6">管理员列表</h1>
        <AdminUserList
          users={users}
          currentAdminId={admin.authSource === "root" ? admin.legacyAdminId : undefined}
        />
      </div>
    </div>
  );
}
