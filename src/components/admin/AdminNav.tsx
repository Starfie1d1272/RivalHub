"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { logoutUser } from "@/actions/auth";

const NAV_ITEMS = [
  { label: "赛季列表", href: "/admin" },
  { label: "邀请码", href: "/admin/invites" },
  { label: "管理员", href: "/admin/users" },
  { label: "修改密码", href: "/admin/settings" },
] as const;

function isActive(href: string, pathname: string): boolean {
  if (href === "/admin") {
    return (
      pathname === "/admin" ||
      (pathname.startsWith("/admin/") &&
        !NAV_ITEMS.slice(1).some((item) => pathname.startsWith(item.href)))
    );
  }
  return pathname === href || pathname.startsWith(href + "/");
}

export function AdminNav({ email }: { email?: string }) {
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
    <div className="border-b border-[var(--border)] bg-[var(--bg-elevated)]/95">
      <div className="container mx-auto px-4 h-12 flex items-center justify-between text-sm">
        <div className="flex items-center gap-6">
          <Link href="/admin" className="font-semibold text-[var(--text-primary)]">
            管理后台
          </Link>
          <nav className="flex items-center gap-4 text-[var(--text-secondary)]">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={
                  isActive(item.href, pathname)
                    ? "text-[var(--text-primary)]"
                    : "hover:text-[var(--text-primary)] transition-colors"
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {email && (
            <span className="text-[var(--text-secondary)]">{email}</span>
          )}
          <button
            onClick={handleLogout}
            disabled={isPending}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
          >
            {isPending ? "退出中…" : "退出登录"}
          </button>
        </div>
      </div>
    </div>
  );
}
