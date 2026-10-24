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
      { href: "/admin/operations", label: "运营概览" },
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
    items: [{ href: "/admin/settings", label: "环境与服务状态" }, { href: "/admin/telemetry", label: "遥测分析" }],
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

export interface AdminSeasonOption {
  id: string;
  slug: string;
  name: string;
  competitionTemplate: string;
  hasCaptainVoting: boolean;
  hasDraft: boolean;
  hasCommunityAwards: boolean;
}

export function getSeasonAdminNavigation(season: AdminSeasonOption, role: AdminRole): AdminNavGroup[] {
  const root = `/admin/${season.slug}`;
  return [
    { key: "workspace", label: "本届工作", items: [
      { href: root, label: "赛事总览" },
      { href: `${root}/registrations`, label: "参赛管理" },
      ...(season.hasCaptainVoting ? [{ href: `${root}/captains`, label: "队长确认" }] : []),
      ...(season.hasDraft ? [{ href: `${root}/draft`, label: "选秀与阵容" }] : []),
      { href: `${root}/prestart`, label: "开赛筹备" },
      { href: `${root}/matches`, label: "比赛与赛程" },
      ...(season.competitionTemplate === "major" ? [{ href: `${root}/bet`, label: "竞猜运营" }] : []),
    ] },
    { key: "content", label: "内容与收尾", items: [
      { href: `${root}/announcements`, label: "本届公告" },
      { href: `${root}/information`, label: "赛事信息" },
      ...(season.hasCommunityAwards ? [{ href: `${root}/community-awards`, label: "社区奖" }] : []),
      { href: `${root}/post-event`, label: "结果与荣誉" },
    ] },
    { key: "governance", label: "管理与工具", items: [
      { href: `${root}/test-matches`, label: "测试赛" },
      { href: `${root}/discipline`, label: "纪律与处罚" },
      { href: `${root}/logs`, label: "操作记录" },
      ...(role === "super_admin" ? [{ href: `${root}/settings`, label: "赛事设置" }] : []),
    ] },
  ];
}
