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

  const isActive = (s: (typeof allSeasons)[number]) =>
    s.status !== "archived" && s.status !== "finished" && s.status !== "draft";

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <Marker>赛季管理</Marker>
        {admin.role === "super_admin" && (
          <Btn small asChild>
            <Link href="/admin/seasons/new">新建赛季</Link>
          </Btn>
        )}
      </div>

      {allSeasons.length === 0 ? (
        <p className="text-[var(--color-fg-mid)]">暂无赛季数据</p>
      ) : (
        <div className="space-y-3">
          {allSeasons.map((s) => {
            const active = isActive(s);
            const hasMatches = (s.stagePlan as unknown[]).length > 0;
            return (
              <Panel key={s.id} pad={16}>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <Link
                    href={`/admin/${s.slug}/matches`}
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
                    <StatusPill status={s.status} />

                    {active ? (
                      <>
                        <Btn small asChild>
                          <Link href={`/admin/${s.slug}/matches`}>比赛管理</Link>
                        </Btn>
                        <Btn small asChild>
                          <Link href={`/admin/${s.slug}/registrations`}>报名审核</Link>
                        </Btn>
                        {s.hasDraft && (
                          <Btn small ghost asChild>
                            <Link href={`/admin/${s.slug}/draft`}>选秀</Link>
                          </Btn>
                        )}
                        {s.hasCaptainVoting && (
                          <Btn small ghost asChild>
                            <Link href={`/admin/${s.slug}/captains`}>队长投票</Link>
                          </Btn>
                        )}
                        {admin.role === "super_admin" && (
                          <Btn small ghost asChild>
                            <Link href={`/admin/${s.slug}/settings`}>设置</Link>
                          </Btn>
                        )}
                      </>
                    ) : (
                      <>
                        {hasMatches && (
                          <Btn small asChild>
                            <Link href={`/admin/${s.slug}/matches`}>查看赛季</Link>
                          </Btn>
                        )}
                        {admin.role === "super_admin" && (
                          <Btn small ghost asChild>
                            <Link href={`/admin/${s.slug}/settings`}>设置</Link>
                          </Btn>
                        )}
                      </>
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
