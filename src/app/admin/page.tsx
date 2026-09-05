import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import {
  SEASON_LIFECYCLE_GROUPS,
  groupSeasonsByLifecycle,
  presentSeasonLifecycle,
  presentSeasonLifecycleSummary,
  presentSeasonStatus,
} from "@/lib/seasons/presentation";
import { Panel, StatusPill, Marker } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";

export default async function AdminDashboardPage() {
  const admin = await resolveAdminPageAccess(requireAdmin);
  if (!admin) return <AdminAccessDenied />;

  const allSeasons =
    admin.role === "super_admin"
      ? await db.select().from(seasons).orderBy(desc(seasons.createdAt))
      : admin.seasonIds.length > 0
        ? await db
            .select()
            .from(seasons)
            .where(inArray(seasons.id, admin.seasonIds))
            .orderBy(desc(seasons.createdAt))
        : [];
  const seasonsByLifecycle = groupSeasonsByLifecycle(allSeasons);

  return (
    <div className="container mx-auto max-w-5xl space-y-8 px-4 py-8">
      <Marker
        sub={`${allSeasons.length} 个赛事`}
        action={admin.role === "super_admin" ? (
          <Button size="sm" variant="outline" asChild>
            <Link href="/admin/seasons/new">新建赛事</Link>
          </Button>
        ) : undefined}
      >
        赛事
      </Marker>

      {allSeasons.length === 0 ? (
        <Panel>
          <p className="text-[var(--color-fg-mid)]">暂无可管理的赛事</p>
        </Panel>
      ) : (
        <div className="space-y-10">
          {SEASON_LIFECYCLE_GROUPS.map((group) => {
            const groupSeasons = seasonsByLifecycle[group.key];
            if (groupSeasons.length === 0) return null;

            return (
              <section key={group.key} aria-labelledby={`season-group-${group.key}`} className="space-y-3">
                <div className="flex items-end justify-between gap-3 border-b border-[var(--color-border)] pb-2">
                  <div>
                    <p className="font-mono text-[10px] tracking-[var(--tracking-label)] text-[var(--color-fg-dim)]">
                      {group.marker}
                    </p>
                    <h2 id={`season-group-${group.key}`} className="mt-1 text-xl font-semibold text-[var(--color-fg)]">
                      {group.label}
                    </h2>
                  </div>
                  <span className="text-xs text-[var(--color-fg-dim)]">{groupSeasons.length} 个赛事</span>
                </div>

                <div className="grid gap-3">
                  {groupSeasons.map((season) => (
                    <Panel key={season.id} pad={16}>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/admin/${season.slug}`}
                              className="font-medium text-[var(--color-fg)] transition-colors hover:text-[var(--color-accent)]"
                            >
                              {season.name}
                            </Link>
                            <StatusPill {...presentSeasonLifecycle(season)} />
                            <StatusPill {...presentSeasonStatus(season.status)} />
                          </div>
                          <p className="mt-1 font-mono text-xs text-[var(--color-fg-dim)]">{season.slug}</p>
                          <p className="mt-2 text-sm text-[var(--color-fg-mid)]">{presentSeasonLifecycleSummary(season)}</p>
                        </div>

                        <Button size="sm" className="shrink-0" asChild>
                          <Link href={`/admin/${season.slug}`}>进入赛事工作区 →</Link>
                        </Button>
                      </div>
                    </Panel>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
