export type AdminRole = "season_admin" | "super_admin";

export interface AdminNavItem {
  href: string;
  label: string;
  superAdminOnly?: boolean;
}

export interface AdminNavGroup {
  key: string;
  label: string;
  items: readonly AdminNavItem[];
}

interface AdminNavGroupDefinition extends AdminNavGroup {
  superAdminOnly?: boolean;
}

const ADMIN_NAV_GROUPS: readonly AdminNavGroupDefinition[] = [
  {
    key: "seasons",
    label: "赛事",
    items: [{ href: "/admin", label: "赛事目录" }],
  },
  {
    key: "operations",
    label: "运营",
    items: [
      { href: "/admin/operations/announcements", label: "公告" },
      { href: "/admin/operations/season-info", label: "赛事信息" },
      { href: "/admin/operations/feedback", label: "用户反馈", superAdminOnly: true },
    ],
  },
  {
    key: "user-permissions",
    label: "用户与权限",
    superAdminOnly: true,
    items: [
      { href: "/admin/users", label: "用户与管理员" },
      { href: "/admin/invites", label: "邀请码" },
    ],
  },
  {
    key: "education",
    label: "教育认证",
    superAdminOnly: true,
    items: [{ href: "/admin/education-verifications", label: "认证审核队列" }],
  },
  {
    key: "competitive",
    label: "竞技平台",
    superAdminOnly: true,
    items: [
      { href: "/admin/competitive-seasons", label: "平台与赛季目录" },
      { href: "/admin/competitive-seasons/conversion-policies", label: "跨平台换算策略" },
    ],
  },
  {
    key: "logs",
    label: "操作日志",
    superAdminOnly: true,
    items: [{ href: "/admin/logs", label: "跨赛事审计" }],
  },
  {
    key: "system-status",
    label: "系统状态",
    superAdminOnly: true,
    items: [{ href: "/admin/settings", label: "环境与服务状态" }],
  },
];

export function getAdminNavigation(role: AdminRole): AdminNavGroup[] {
  return ADMIN_NAV_GROUPS
    .filter((group) => !group.superAdminOnly || role === "super_admin")
    .map((group) => ({
      key: group.key,
      label: group.label,
      items: group.items.filter((item) => !item.superAdminOnly || role === "super_admin"),
    }))
    .filter((group) => group.items.length > 0);
}

/** Select the single most specific visible navigation destination. */
export function getActiveAdminNavigationHref(pathname: string, groups: readonly AdminNavGroup[]): string | null {
  return groups.flatMap((group) => group.items)
    .filter(({ href }) => pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}
