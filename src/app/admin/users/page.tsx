import { redirect } from "next/navigation";
import Link from "next/link";
import { asc, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { seasonAdminGrants, users } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth/session";
import { Marker, Panel, Btn } from "@/components/rivalhub";
import { AdminUserList } from "@/components/admin/AdminUserList";
import { UserSearchBar } from "@/components/admin/UserSearchBar";
import { formatCST } from "@/lib/utils/date";
import { getDisplayName } from "@/lib/utils/display-name";

interface PageProps {
  searchParams: Promise<{ tab?: string; q?: string; filter?: string }>;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  let admin;
  try {
    admin = await requireSuperAdmin();
  } catch {
    redirect("/login");
  }

  const { tab = "admins", q = "", filter = "all" } = await searchParams;

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
        .where(or(eq(users.role, "super_admin"), isNotNull(seasonAdminGrants.userId)))
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
      <div className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
        <Marker>用户管理</Marker>
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
      </div>
    );
  }

  // ── 所有用户 Tab ────────────────────────────────────────────────────────
  const havingClause =
    filter === "participated"
      ? sql`HAVING COUNT(DISTINCT sr.season_id) > 0`
      : filter === "none"
        ? sql`HAVING COUNT(DISTINCT sr.season_id) = 0`
        : sql``;

  const searchClause = q
    ? sql`AND (u.email ILIKE ${"%" + q + "%"} OR u.display_name ILIKE ${"%" + q + "%"} OR u.perfect_name ILIKE ${"%" + q + "%"} OR u.steam_name ILIKE ${"%" + q + "%"})`
    : sql``;

  const [{ rows }, { rows: statsRows }] = await Promise.all([
    db.execute(sql`
      SELECT
        u.id,
        u.email,
        u.display_name,
        u.perfect_name,
        u.steam_name,
        u.created_at,
        COUNT(DISTINCT sr.season_id)::int AS season_count
      FROM users u
      LEFT JOIN season_registrations sr ON sr.user_id = u.id
      WHERE u.role = 'user'
        ${searchClause}
      GROUP BY u.id
      ${havingClause}
      ORDER BY u.created_at DESC
      LIMIT 200
    `),
    db.execute(sql`
      SELECT
        COUNT(*)::int                                                             AS total,
        COUNT(*) FILTER (WHERE season_count > 0)::int                           AS participated,
        COUNT(*) FILTER (WHERE season_count = 0)::int                           AS not_participated,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int   AS recent_30d
      FROM (
        SELECT u.id, u.created_at, COUNT(DISTINCT sr.season_id) AS season_count
        FROM users u
        LEFT JOIN season_registrations sr ON sr.user_id = u.id
        GROUP BY u.id, u.created_at
      ) sub
    `),
  ]);

  const stats = statsRows[0] ?? {};

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
      <Marker>用户管理</Marker>
      <TabBar tab="users" />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "总注册用户", value: stats.total ?? 0 },
          { label: "参赛过", value: stats.participated ?? 0, accent: true },
          { label: "仅注册未参赛", value: stats.not_participated ?? 0 },
          { label: "近 30 天新增", value: stats.recent_30d ?? 0 },
        ].map(({ label, value, accent }) => (
          <Panel key={label} pad={16}>
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
      <UserSearchBar q={q} filter={filter} />

      {/* 表格 */}
      <Panel pad={0} className="overflow-hidden">
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
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[var(--color-fg-dim)] text-sm">
                    暂无匹配用户
                  </td>
                </tr>
              )}
              {rows.map((r) => {
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
      {rows.length === 200 && (
        <p className="text-xs text-center text-[var(--color-fg-dim)]">
          仅显示最近 200 条，请使用搜索缩小范围
        </p>
      )}
    </div>
  );
}

function TabBar({ tab }: { tab: string }) {
  return (
    <div className="flex gap-1">
      <Btn small ghost={tab !== "admins"} asChild>
        <Link href="/admin/users?tab=admins">管理员</Link>
      </Btn>
      <Btn small ghost={tab !== "users"} asChild>
        <Link href="/admin/users?tab=users">所有用户</Link>
      </Btn>
    </div>
  );
}
