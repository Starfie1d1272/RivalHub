"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { toast } from "sonner";
import { APP_BRAND } from "@/lib/branding";
import { cn } from "@/lib/utils/cn";
import { SEASON_STATUS_LABELS } from "@/types/season";
import { logoutUser } from "@/actions/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SeasonStatus } from "@/types/season";
import { OnlineCounter } from "./OnlineCounter";

export interface HeaderSeason {
  slug: string;
  name: string;
  status: SeasonStatus;
}

export interface HeaderSession {
  userId: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

interface HeaderClientProps {
  seasons: HeaderSeason[];
  session: HeaderSession | null;
  avatarUrl?: string | null;
  steamName?: string | null;
  displayName?: string | null;
}

function AvatarButton({ label, avatarUrl, imgError, onImgError }: {
  label: string;
  avatarUrl?: string | null;
  imgError: boolean;
  onImgError: () => void;
}) {
  const initial = label.charAt(0).toUpperCase();

  if (avatarUrl && !imgError) {
    return (
      <Image
        src={avatarUrl}
        alt={label}
        width={32}
        height={32}
        className="inline-flex w-8 h-8 rounded-full border border-[var(--color-border)] object-cover"
        referrerPolicy="no-referrer"
        onError={onImgError}
      />
    );
  }

  return (
    <span
      className="inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold text-white"
      style={{ backgroundColor: "var(--color-accent)" }}
    >
      {initial}
    </span>
  );
}

export function HeaderClient({ seasons, session, avatarUrl, steamName, displayName }: HeaderClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const seasonLinks = seasons.map((s) => ({
    href: `/${s.slug}`,
    label: s.name,
    badge: SEASON_STATUS_LABELS[s.status] ?? s.status,
    active: pathname.startsWith(`/${s.slug}`),
  }));
  const navLinks = [
    { href: "/seasons", label: "赛事", badge: null, active: pathname === "/seasons" },
    { href: "/teams", label: "队伍", badge: null, active: pathname.startsWith("/teams") },
    ...seasonLinks,
  ];

  async function handleLogout() {
    const result = await logoutUser();
    if (result.success) {
      toast.success("已退出登录");
      router.push("/");
    } else {
      toast.error("退出失败，请重试");
    }
  }

  const isAdmin = session?.isAdmin;
  const isSuperAdmin = session?.isSuperAdmin;
  const userLabel = displayName ?? steamName ?? "RivalHub";

  return (
    <header
      className="sticky top-0 z-50 border-b backdrop-blur"
      style={{
        padding: "12px 28px",
        background: "color-mix(in srgb, var(--color-panel-low) 90%, transparent)",
        borderColor: "var(--color-border)",
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 24,
        alignItems: "center",
      }}
    >
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2.5 font-bold text-base text-[var(--color-fg)] hover:text-[var(--color-fg)] transition-colors"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            letterSpacing: "var(--tracking-tight-1)",
          }}
        >
          <Image
            src="/brand/rivalhub/favicon-32-transparent.png"
            alt=""
            width={28}
            height={28}
            className="rounded-sm"
          />
          {APP_BRAND.name.toUpperCase()}
        </Link>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center justify-center gap-0.5 flex-wrap">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href as never}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors",
                link.active
                  ? "bg-[var(--color-panel)] border-b border-[var(--color-accent)] text-[var(--color-fg)] font-semibold"
                  : "text-[var(--color-fg-mid)] border-b border-transparent hover:text-[var(--color-fg)] font-medium",
                "rounded-sm"
              )}
              style={{ fontFamily: "var(--font-sans)" }}
            >
              {link.label}
              {link.badge && <span
                className="text-xs px-1.5 py-0.5 rounded-sm"
                style={{
                  background: "var(--color-panel-low)",
                  color: "var(--color-fg-dim)",
                }}
              >
                {link.badge}
              </span>}
            </Link>
          ))}
        </nav>

        {/* 右侧：在线人数 + 用户区域 + mobile hamburger */}
        <div className="flex items-center gap-3">
          {/* 在线人数 */}
          <div className="hidden sm:flex items-center">
            <OnlineCounter />
          </div>

          {/* 用户区域（仅桌面） */}
          <div className="hidden sm:block">
            {session ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] rounded-full">
                    <AvatarButton label={userLabel} avatarUrl={avatarUrl} imgError={imgError} onImgError={() => setImgError(true)} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 bg-[var(--color-panel)] border-[var(--color-border)]">
                  {isAdmin && (
                    <DropdownMenuItem asChild>
                      <Link href="/admin" className="cursor-pointer">
                        管理后台
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem asChild>
                    <Link href="/my" className="cursor-pointer">我的</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/players/${session.userId}`} className="cursor-pointer">
                      我的主页
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={"/settings" as never} className="cursor-pointer flex items-center gap-1.5">
                      个人信息
                      {!displayName && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] flex-shrink-0" />
                      )}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={"/settings/password" as never} className="cursor-pointer">
                      修改密码
                    </Link>
                  </DropdownMenuItem>
                  {!isSuperAdmin && (
                    <DropdownMenuItem asChild>
                      <Link href="/invite" className="cursor-pointer">
                        使用邀请码
                      </Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-[var(--color-danger)] focus:text-[var(--color-danger)] cursor-pointer"
                    onSelect={handleLogout}
                  >
                    退出登录
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link
                href="/login"
                className="px-2 py-1 rounded-sm text-xs font-bold text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] border border-[var(--color-border)] transition-colors"
                style={{
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "var(--tracking-label)",
                }}
              >
                登录
              </Link>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="sm:hidden p-2 text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="菜单"
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="sm:hidden border-t border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3 flex flex-col gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href as never}
              onClick={() => setMobileOpen(false)}
              className="flex items-center justify-between px-3 py-2 rounded-md text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel-hi)]"
            >
              {link.label}
              <span className="text-xs text-[var(--color-fg-dim)]">{link.badge}</span>
            </Link>
          ))}

          {/* 移动端用户区域 */}
          <div className="mt-2 pt-2 border-t border-[var(--color-border)] flex flex-col gap-1">
            {session ? (
              <>
                <div className="flex items-center gap-2 px-3 py-1.5">
                  <AvatarButton label={userLabel} avatarUrl={avatarUrl} imgError={imgError} onImgError={() => setImgError(true)} />
                  <span className="text-sm text-[var(--color-fg-dim)] truncate">{userLabel}</span>
                </div>
                {isAdmin && (
                  <Link
                    href="/admin"
                    onClick={() => setMobileOpen(false)}
                    className="px-3 py-2 rounded-md text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel-hi)]"
                  >
                    管理后台
                  </Link>
                )}
                <Link
                  href="/my"
                  onClick={() => setMobileOpen(false)}
                  className="px-3 py-2 rounded-md text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel-hi)]"
                >
                  我的
                </Link>
                <Link
                  href={`/players/${session.userId}`}
                  onClick={() => setMobileOpen(false)}
                  className="px-3 py-2 rounded-md text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel-hi)]"
                >
                  我的主页
                </Link>
                <Link
                  href={"/settings" as never}
                  onClick={() => setMobileOpen(false)}
                  className="px-3 py-2 rounded-md text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel-hi)] flex items-center gap-1.5"
                >
                  个人信息
                  {!displayName && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] flex-shrink-0" />
                  )}
                </Link>
                <Link
                  href={"/settings/password" as never}
                  onClick={() => setMobileOpen(false)}
                  className="px-3 py-2 rounded-md text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel-hi)]"
                >
                  修改密码
                </Link>
                {!isSuperAdmin && (
                  <Link
                    href="/invite"
                    onClick={() => setMobileOpen(false)}
                    className="px-3 py-2 rounded-md text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel-hi)]"
                  >
                    使用邀请码
                  </Link>
                )}
                <button
                  onClick={() => {
                    setMobileOpen(false);
                    void handleLogout();
                  }}
                  className="text-left px-3 py-2 rounded-md text-sm text-[var(--color-danger)] hover:bg-[var(--color-panel-hi)]"
                >
                  退出登录
                </button>
              </>
            ) : (
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="px-3 py-2 rounded-md text-sm font-medium text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel-hi)]"
              >
                登录
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
