"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { logoutUser } from "@/actions/auth";

const NAV_ITEMS = [
  { href: "/admin", label: "赛季管理" },
  { href: "/admin/users", label: "用户管理" },
  { href: "/admin/invites", label: "邀请码" },
  { href: "/admin/logs", label: "操作日志" },
  { href: "/admin/settings", label: "系统设置" },
] as const;

export function AdminSidebar({ email }: { email: string }) {
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
      className="flex flex-col h-full"
      style={{
        background: "var(--color-panel-low)",
        borderRight: "1px solid var(--color-border)",
        padding: "20px 0",
      }}
    >
      {/* header */}
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

      {/* nav */}
      <nav className="flex-1">
        {NAV_ITEMS.map((item) => {
          const active = item.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(item.href);
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
      </nav>

      {/* footer */}
      <div
        className="px-5 pt-4 mt-auto"
        style={{ borderTop: "1px solid var(--color-border)" }}
      >
        <div
          className="truncate mb-2"
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
