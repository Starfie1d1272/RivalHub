"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { logoutUser } from "@/actions/auth";
import { getAdminNavigation, type AdminRole } from "@/lib/admin/navigation";

export function AdminSidebar({ email, role }: { email: string; role: AdminRole }) {
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
      <nav aria-label="管理后台导航" className="flex min-w-0 flex-1 overflow-x-auto md:block">
        {getAdminNavigation(role).map((group) => (
          <div key={group.key} className="shrink-0 md:mb-3">
            <div
              className="px-3 pb-1 pt-2.5 md:px-5 md:pt-1"
              style={{
                color: "var(--color-fg-dim)",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "var(--tracking-label)",
              }}
            >
              {group.label}
            </div>
            {group.items.map((item) => {
              const active = item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href as never}
                  aria-current={active ? "page" : undefined}
                  className="inline-flex shrink-0 items-center px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] md:block md:px-5 md:py-2"
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
          </div>
        ))}
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
          className="text-xs text-[var(--color-fg-mid)] transition-colors hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 disabled:opacity-50"
        >
          {isPending ? "退出中…" : "退出登录 →"}
        </button>
      </div>
    </div>
  );
}
