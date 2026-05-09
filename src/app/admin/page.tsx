import Link from "next/link";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { checkAdminSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function AdminDashboardPage() {
  const admin = (await checkAdminSession())!;

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
    <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">赛季列表</h1>
          {admin.role === "super_admin" && (
            <div className="flex items-center gap-2">
              <Link href={"/admin/seasons/new" as never}>
                <Button size="sm">
                  新建赛季
                </Button>
              </Link>
              <Link href="/admin/invites">
                <Button variant="outline" size="sm">
                  管理邀请码
                </Button>
              </Link>
            </div>
          )}
        </div>

        {allSeasons.length === 0 ? (
          <p className="text-[var(--text-secondary)]">暂无赛季数据</p>
        ) : (
          <div className="space-y-3">
            {allSeasons.map((s) => (
              <Card key={s.id} className="p-4 flex items-center justify-between gap-4">
                <Link
                  href={`/admin/${s.slug}/registrations`}
                  className="min-w-0 flex-1 hover:text-[var(--text-primary)] transition-colors"
                >
                  <div>
                    <span className="font-medium">{s.name}</span>
                    <span className="text-sm text-[var(--text-secondary)] ml-2">
                      {s.slug}
                    </span>
                  </div>
                </Link>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{s.status}</Badge>
                  {admin.role === "super_admin" && (
                    <Link href={`/admin/${s.slug}/settings` as never}>
                      <Button variant="outline" size="sm">设置</Button>
                    </Link>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
    </div>
  );
}
