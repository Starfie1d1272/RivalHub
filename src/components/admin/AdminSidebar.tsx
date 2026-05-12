"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/admin", label: "概览" },
  { href: "/admin/users", label: "用户管理" },
  { href: "/admin/invites", label: "邀请码" },
  { href: "/admin/settings", label: "系统设置" },
] as const;

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <div
      style={{
        background: "var(--color-panel-low)",
        borderRight: "1px solid var(--color-border)",
        padding: "20px 0",
      }}
    >
      <div
        className="px-5 pb-4 font-bold uppercase"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--color-accent)",
          letterSpacing: "var(--tracking-eyebrow)",
        }}
      >
        [ ADMIN ]
      </div>
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className="block"
            style={{
              padding: "10px 20px",
              background: active ? "var(--color-panel)" : "transparent",
              borderLeft: `2px solid ${active ? "var(--color-accent)" : "transparent"}`,
              color: active ? "var(--color-fg)" : "var(--color-fg-mid)",
              fontFamily: "var(--font-sans)",
              fontWeight: active ? 600 : 500,
              fontSize: 13,
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
