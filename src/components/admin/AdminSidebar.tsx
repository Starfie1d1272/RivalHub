"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { logoutUser } from "@/actions/auth";

const NAV_ITEMS = [
  { href: "/admin", label: "赛季管理" },
  { href: "/admin/users", label: "用户管理" },
  { href: "/admin/education-verifications", label: "教育认证审核" },
  { href: "/admin/invites", label: "邀请码" },
  { href: "/admin/competitive-seasons", label: "竞技平台", superAdminOnly: true },
  { href: "/admin/logs", label: "操作日志" },
  { href: "/admin/settings", label: "系统设置" },
] as const;

export function AdminSidebar({ email, role }: { email: string; role: "season_admin" | "super_admin" }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleLogout() {
    startTransition(async () => {
      await logoutUser();
      toast.success("已退出登录");
      router.push("/login");
    });
  }

  return (
    <div
      className="flex items-center border-b border-[var(--color-border)] md:h-full md:flex-col md:items-stretch md:border-b-0 md:border-r"
      style={{
        background: "var(--color-panel-low)",
      }}
    >
      {/* header */}
      <div
        className="shrink-0 px-4 py-3 font-bold uppercase md:px-5 md:pb-4 md:pt-5"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--color-accent)",
          letterSpacing: "var(--tracking-eyebrow)",
        }}
      >
        [ ADMIN ]
      </div>

      {/* nav */}
      <nav className="flex min-w-0 flex-1 overflow-x-auto md:block">
        {NAV_ITEMS.filter((item) => !("superAdminOnly" in item && item.superAdminOnly) || role === "super_admin").map((item) => {
          const active = item.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex shrink-0 items-center px-3 py-3 md:block md:px-5 md:py-2.5"
              style={{
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
      </nav>

      {/* footer */}
      <div
        className="ml-auto shrink-0 px-4 md:mt-auto md:px-5 md:pt-4"
        style={{ borderTop: "1px solid var(--color-border)" }}
      >
        <div
          className="mb-2 hidden truncate md:block"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--color-fg-dim)",
          }}
        >
          {email}
        </div>
        <button
          onClick={handleLogout}
          disabled={isPending}
          className="text-xs text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] transition-colors disabled:opacity-50"
        >
          {isPending ? "退出中…" : "退出登录 →"}
        </button>
      </div>
    </div>
  );
}
