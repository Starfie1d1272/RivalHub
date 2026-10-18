"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { logoutAndClearPreviousViews } from "@/components/auth/logout";
import { getAdminNavigation, getSeasonAdminNavigation, getActiveAdminNavigationHref, type AdminRole, type AdminSeasonOption } from "@/lib/admin/navigation";

export function AdminSidebar({ email, role, seasons }: { email: string; role: AdminRole; seasons: AdminSeasonOption[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams();
  const season = seasons.find((option) => option.slug === params.seasonSlug);
  const navigation = season ? getSeasonAdminNavigation(season, role) : getAdminNavigation(role);
  const activeHref = getActiveAdminNavigationHref(pathname, navigation);
  const [isPending, startTransition] = useTransition();

  function handleLogout() {
    startTransition(async () => {
      const result = await logoutAndClearPreviousViews();
      if (!result.success) { toast.error(result.error.message); return; }
      toast.success("已退出登录");
      router.push("/login");
    });
  }

  return (
    <div
      className="flex flex-col items-stretch border-b border-[var(--color-border)] md:sticky md:top-0 md:h-screen md:overflow-y-auto md:flex-col md:items-stretch md:border-b-0 md:border-r"
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
        {season ? "赛事工作区" : "平台管理"}
      </div>

      <div className="space-y-3 border-b border-[var(--color-border)] px-4 pb-4">
        <label className="block text-xs text-[var(--color-fg-mid)]" htmlFor="admin-season-switch">当前工作范围</label>
        <select id="admin-season-switch" value={season?.slug ?? ""}
          onChange={(event) => router.push(event.target.value ? `/admin/${event.target.value}` : "/admin/operations")}
          className="w-full min-w-0 rounded-sm border border-[var(--color-border)] bg-[var(--color-panel)] p-2 text-sm">
          <option value="">平台管理</option>
          {seasons.map((option) => <option key={option.id} value={option.slug}>{option.name}</option>)}
        </select>
        <div className="flex flex-wrap gap-3 text-xs text-[var(--color-fg-mid)]">
          <Link href="/admin">赛事目录</Link>
          {season && <Link href={`/${season.slug}`}>查看公开赛事 ↗</Link>}
        </div>
      </div>
      <p className="px-4 pt-2 text-xs text-[var(--color-fg-dim)] md:hidden">左右滑动查看全部管理入口</p>
      {/* nav */}
      <nav aria-label="管理后台导航" className="flex min-w-0 flex-1 overflow-x-auto md:block md:overflow-y-auto">
        {navigation.map((group) => (
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
              const active = item.href === activeHref;
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
