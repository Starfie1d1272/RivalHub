import { redirect } from "next/navigation";
import Link from "next/link";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { checkAdminSession } from "@/lib/auth/session";
import { AdminNav } from "@/components/admin/AdminNav";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function AdminDashboardPage() {
  const admin = await checkAdminSession();
  if (!admin) redirect("/admin/login");

  const allSeasons =
    admin.role === "super_admin"
      ? await db.select().from(seasons).orderBy(seasons.createdAt)
      : admin.adminSeasonIds.length > 0
        ? await db
            .select()
            .from(seasons)
            .where(inArray(seasons.id, admin.adminSeasonIds))
            .orderBy(seasons.createdAt)
        : [];

  return (
    <div className="min-h-screen">
      <AdminNav email={admin.email} />

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">赛季列表</h1>
          {admin.role === "super_admin" && (
            <Link href="/admin/invites">
              <Button variant="outline" size="sm">
                管理邀请码
              </Button>
            </Link>
          )}
        </div>

        {allSeasons.length === 0 ? (
          <p className="text-[var(--text-secondary)]">暂无赛季数据</p>
        ) : (
          <div className="space-y-3">
            {allSeasons.map((s) => (
              <Link key={s.id} href={`/admin/${s.slug}/registrations`}>
                <Card className="p-4 hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer flex items-center justify-between">
                  <div>
                    <span className="font-medium">{s.name}</span>
                    <span className="text-sm text-[var(--text-secondary)] ml-2">
                      {s.slug}
                    </span>
                  </div>
                  <Badge variant="outline">{s.status}</Badge>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
