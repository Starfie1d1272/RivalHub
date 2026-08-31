import Link from "next/link";
import { inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { checkAdminSession } from "@/lib/auth/session";
import { presentSeasonStatus } from "@/lib/seasons/presentation";
import { Panel, StatusPill, Marker } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";

export default async function AdminDashboardPage() {
  const admin = await checkAdminSession();
  if (!admin) redirect("/login");

  const allSeasons =
    admin.role === "super_admin"
      ? await db.select().from(seasons).orderBy(seasons.createdAt)
      : admin.seasonIds.length > 0
        ? await db
            .select()
            .from(seasons)
            .where(inArray(seasons.id, admin.seasonIds))
            .orderBy(seasons.createdAt)
        : [];

  const isActive = (s: (typeof allSeasons)[number]) =>
    s.status !== "archived" && s.status !== "finished" && s.status !== "draft";

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <Marker>赛季管理</Marker>
        {admin.role === "super_admin" && (
          <Button size="sm" variant="outline" asChild>
            <Link href="/admin/seasons/new">新建赛季</Link>
          </Button>
        )}
      </div>

      {allSeasons.length === 0 ? (
        <p className="text-[var(--color-fg-mid)]">暂无赛季数据</p>
      ) : (
        <div className="space-y-3">
          {allSeasons.map((s) => {
            const active = isActive(s);
            return (
              <Panel key={s.id} pad={16}>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <Link
                    href={`/admin/${s.slug}`}
                    className="min-w-0 flex-1 hover:text-[var(--color-fg)] transition-colors"
                  >
                    <div>
                      <span className="font-medium">{s.name}</span>
                      <span className="text-sm text-[var(--color-fg-mid)] ml-2">
                        {s.slug}
                      </span>
                    </div>
                  </Link>

                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusPill {...presentSeasonStatus(s.status)} />

                    <Button size="sm" asChild>
                      <Link href={`/admin/${s.slug}`}>赛事控制台</Link>
                    </Button>

                    {active && (
                      <>
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/admin/${s.slug}/matches`}>比赛管理</Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/admin/${s.slug}/registrations`}>报名审核</Link>
                        </Button>
                        {s.hasDraft && (
                          <Button size="sm" variant="ghost" asChild>
                            <Link href={`/admin/${s.slug}/draft`}>选秀</Link>
                          </Button>
                        )}
                        {s.hasCaptainVoting && (
                          <Button size="sm" variant="ghost" asChild>
                            <Link href={`/admin/${s.slug}/captains`}>队长投票</Link>
                          </Button>
                        )}
                      </>
                    )}

                    {admin.role === "super_admin" && (
                      <Button size="sm" variant="ghost" asChild>
                        <Link href={`/admin/${s.slug}/settings`}>设置</Link>
                      </Button>
                    )}
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
