import Link from "next/link";
import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { checkAdminSession } from "@/lib/auth/session";
import { Panel, Btn, StatusPill, Marker } from "@/components/rivalhub";

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
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
          <Marker>赛季管理</Marker>
          {admin.role === "super_admin" && (
            <div className="flex items-center gap-2">
              <Btn small asChild>
                <Link href="/admin/seasons/new">新建赛季</Link>
              </Btn>
            </div>
          )}
        </div>

        {allSeasons.length === 0 ? (
          <p className="text-[var(--color-fg-mid)]">暂无赛季数据</p>
        ) : (
          <div className="space-y-3">
            {allSeasons.map((s) => (
              <Panel key={s.id} pad={16} className="flex items-center justify-between gap-4">
                <Link
                  href={`/admin/${s.slug}/registrations`}
                  className="min-w-0 flex-1 hover:text-[var(--color-fg)] transition-colors"
                >
                  <div>
                    <span className="font-medium">{s.name}</span>
                    <span className="text-sm text-[var(--color-fg-mid)] ml-2">
                      {s.slug}
                    </span>
                  </div>
                </Link>
                <div className="flex items-center gap-2">
                  <StatusPill status={s.status} />
                  {admin.role === "super_admin" && (
                    <Btn small asChild>
                      <Link href={`/admin/${s.slug}/settings`}>设置</Link>
                    </Btn>
                  )}
                </div>
              </Panel>
            ))}
          </div>
        )}
      </div>
  );
}
