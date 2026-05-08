import Link from "next/link";

interface NavItem {
  label: string;
  href: "/admin" | "/admin/invites" | "/admin/users" | "/admin/settings";
}

export function AdminNav({
  current,
  username,
}: {
  current: string;
  username?: string;
}) {
  const items: NavItem[] = [
    { label: "赛季列表", href: "/admin" },
    { label: "邀请码", href: "/admin/invites" },
    { label: "管理员", href: "/admin/users" },
    { label: "修改密码", href: "/admin/settings" },
  ];

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-elevated)]/95">
      <div className="container mx-auto px-4 h-12 flex items-center justify-between text-sm">
        <div className="flex items-center gap-6">
          <Link
            href="/admin"
            className="font-semibold text-[var(--text-primary)]"
          >
            管理后台
          </Link>
          <nav className="flex items-center gap-4 text-[var(--text-secondary)]">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={
                  item.label === current
                    ? "text-[var(--text-primary)]"
                    : "hover:text-[var(--text-primary)] transition-colors"
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        {username && (
          <span className="text-[var(--text-secondary)]">{username}</span>
        )}
      </div>
    </div>
  );
}
