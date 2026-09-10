import Link from "next/link";
import { and, asc, eq, isNotNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { seasonAdminGrants, users } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { PageHeader, PageLayout, Panel, ResultSummary } from "@/components/rivalhub";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { Button } from "@/components/ui/button";
import { AdminUserList } from "@/components/admin/AdminUserList";
import { AdminUsersListWorkspace } from "@/components/admin/AdminUsersListWorkspace";
import { formatCST } from "@/lib/utils/date";
import { getDisplayName } from "@/lib/identity/display-name";
import { getAdminUserStats, getAdminUsersList, normalizeAdminUsersQuery } from "@/lib/admin/users";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const admin = await resolveAdminPageAccess(requireSuperAdmin);
  if (!admin) return <AdminAccessDenied />;

  const rawSearchParams = await searchParams;
  const tabValue = rawSearchParams.tab;
  const tab = (Array.isArray(tabValue) ? tabValue[0] : tabValue) ?? "admins";

  // ── 管理员 Tab ──────────────────────────────────────────────────────────
  if (tab !== "users") {
    const [adminRows, allSeasons] = await Promise.all([
      db
        .select({
          id: users.id,
          email: users.email,
          steamName: users.steamName,
          displayName: users.displayName,
          perfectName: users.perfectName,
          role: users.role,
          seasonId: seasonAdminGrants.seasonId,
          createdAt: users.createdAt,
        })
        .from(users)
        .leftJoin(seasonAdminGrants, eq(seasonAdminGrants.userId, users.id))
        .where(and(eq(users.status, "active"), or(eq(users.role, "super_admin"), isNotNull(seasonAdminGrants.userId))))
        .orderBy(asc(users.createdAt)),
      db.query.seasons.findMany(),
    ]);
    const seasonMap = Object.fromEntries(allSeasons.map((s) => [s.id, s.name]));
    const adminById = new Map<string, {
      id: string;
      email: string;
      steamName: string | null;
      displayName: string | null;
      perfectName: string | null;
      role: "user" | "super_admin";
      seasonIds: string[];
      createdAt: Date;
    }>();
    for (const row of adminRows) {
      const existing = adminById.get(row.id);
      if (existing) {
        if (row.seasonId) existing.seasonIds.push(row.seasonId);
      } else {
        adminById.set(row.id, {
          id: row.id,
          email: row.email,
          steamName: row.steamName,
          displayName: row.displayName,
          perfectName: row.perfectName,
          role: row.role,
          seasonIds: row.seasonId ? [row.seasonId] : [],
          createdAt: row.createdAt,
        });
      }
    }
    const adminUsers = [...adminById.values()];

    return (
      <PageLayout variant="wide" className="space-y-6">
        <PageHeader title="用户管理" />
        <TabBar tab="admins" />
        <AdminUserList
          users={adminUsers.map((u) => ({
            id: u.id,
            email: u.email,
            steamName: u.steamName,
            displayName: u.displayName,
            perfectName: u.perfectName,
            role: u.role === "super_admin" ? "super_admin" : "season_admin",
            seasonIds: u.seasonIds,
            createdAt: u.createdAt.toISOString(),
          }))}
          seasonMap={seasonMap}
          currentUserId={admin.userId}
        />
      </PageLayout>
    );
  }

  // ── 所有用户 Tab ────────────────────────────────────────────────────────
  const query = normalizeAdminUsersQuery(rawSearchParams);
  const [userList, stats] = await Promise.all([
    getAdminUsersList(query),
    getAdminUserStats(),
  ]);

  return (
    <PageLayout variant="wide" className="space-y-6">
      <PageHeader title="用户管理" />
      <TabBar tab="users" />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "总注册用户", value: stats.total },
          { label: "参赛过", value: stats.participated, accent: true },
          { label: "仅注册未参赛", value: stats.notParticipated },
          { label: "近 30 天新增", value: stats.recent30d },
        ].map(({ label, value, accent }) => (
          <Panel key={label} contentClassName="p-4">
            <p
              className="text-2xl font-bold tabular-nums"
              style={accent ? { color: "var(--color-accent)" } : undefined}
            >
              {String(value)}
            </p>
            <p className="text-xs text-[var(--color-fg-dim)] mt-0.5">{label}</p>
          </Panel>
        ))}
      </div>

      {/* 搜索 + 筛选 */}
      <AdminUsersListWorkspace filter={query.filter} page={userList.page} totalPages={userList.totalPages}>
        {/* 表格 */}
        <Panel contentClassName="p-0" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
                  <th className="px-4 py-3 text-left">选手</th>
                  <th className="px-4 py-3 text-left">邮箱</th>
                  <th className="px-4 py-3 text-center">参赛赛季</th>
                  <th className="px-4 py-3 text-right">注册时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {userList.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-[var(--color-fg-dim)] text-sm">
                      {userList.hasAnyRecords ? "没有符合当前筛选条件的用户" : "暂无用户"}
                    </td>
                  </tr>
                )}
                {userList.rows.map((r) => {
                  const name = getDisplayName({
                    displayName: r.display_name as string | null,
                    perfectName: r.perfect_name as string | null,
                    steamName: r.steam_name as string | null,
                  });
                  const seasonCount = Number(r.season_count);
                  const hasParticipated = seasonCount > 0;
                  return (
                    <tr
                      key={r.id as string}
                      className="hover:bg-[var(--color-surface-raised)] transition-colors"
                    >
                      <td className="px-4 py-2.5 font-medium text-[var(--color-fg)]">
                        {hasParticipated ? (
                          <Link
                            href={`/players/${r.id}`}
                            className="hover:text-[var(--color-accent)] transition-colors"
                          >
                            {name}
                          </Link>
                        ) : (
                          <span className="text-[var(--color-fg-mid)]">{name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-[var(--color-fg-mid)]">
                        {r.email as string}
                      </td>
                      <td className="px-4 py-2.5 text-center tabular-nums text-sm">
                        {hasParticipated ? (
                          <span style={{ color: "var(--color-accent)" }}>{seasonCount}</span>
                        ) : (
                          <span className="text-[var(--color-fg-dim)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-[var(--color-fg-dim)] tabular-nums">
                        {formatCST(r.created_at as string)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="flex items-center justify-between gap-3">
          <ResultSummary
            total={userList.total}
            page={userList.page}
            pageSize={userList.pageSize}
            totalPages={userList.totalPages}
          />
        </div>
      </AdminUsersListWorkspace>
    </PageLayout>
  );
}

function TabBar({ tab }: { tab: string }) {
  return (
    <div className="flex gap-1">
      <Button size="sm" variant={tab !== "admins" ? "ghost" : "outline"} asChild>
        <Link href="/admin/users?tab=admins">管理员</Link>
      </Button>
      <Button size="sm" variant={tab !== "users" ? "ghost" : "outline"} asChild>
        <Link href="/admin/users?tab=users">所有用户</Link>
      </Button>
    </div>
  );
}
