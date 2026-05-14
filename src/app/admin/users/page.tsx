import { redirect } from "next/navigation";
import { ne, asc } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema/users";
import { seasons } from "@/db/schema/seasons";
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

  const [adminUsers, allSeasons] = await Promise.all([
    db.query.users.findMany({
      where: ne(users.role, "user"),
      orderBy: [asc(users.createdAt)],
    }),
    db.query.seasons.findMany(),
  ]);

  const seasonMap = Object.fromEntries(allSeasons.map((s) => [s.id, s.name]));

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <Marker>管理员列表</Marker>
      <AdminUserList
        users={adminUsers.map((u) => ({
          id: u.id,
          email: u.email,
          role: u.role as "super_admin" | "season_admin",
          adminSeasonIds: u.adminSeasonIds,
          createdAt: u.createdAt.toISOString(),
        }))}
        seasonMap={seasonMap}
        currentUserId={admin.userId}
      />
    </div>
  );
}
