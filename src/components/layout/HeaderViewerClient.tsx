"use client";

import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import Link from "next/link";
import React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { logoutUser } from "@/actions/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { HeaderSession } from "./Header.types";
import { useHeaderAvatarFailure } from "./HeaderAvatarFailureContext";
import { getPublicDisplayName } from "@/lib/identity/display-name";

export function getAccountNavigationLinks(userId: string, needsProfile: boolean) {
  return [
    { href: "/my", label: "我的参赛" },
    { href: `/players/${userId}`, label: "个人主页" },
    { href: "/settings", label: "账号设置", needsProfile },
  ];
}

interface HeaderViewerClientProps {
  variant: "desktop" | "mobile";
  session: HeaderSession | null;
  avatarUrl?: string | null;
  steamName?: string | null;
  displayName?: string | null;
  perfectName?: string | null;
}

export function HeaderViewerClient({
  variant,
  session,
  avatarUrl,
  steamName,
  displayName,
  perfectName,
}: HeaderViewerClientProps) {
  const router = useRouter();
  const { avatarFailed, markAvatarFailed } = useHeaderAvatarFailure(avatarUrl);
  const userLabel = getPublicDisplayName({ displayName, perfectName, steamName });

  async function handleLogout() {
    const result = await logoutUser();
    if (result.success) {
      toast.success("已退出登录");
      router.push("/");
    } else {
      toast.error("退出失败，请重试");
    }
  }

  if (variant === "desktop") {
    return (
      <div className="hidden sm:block">
        {session ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] rounded-full">
                <PlayerAvatar
                  name={userLabel} size="sm"
                  avatarUrl={avatarUrl}
                  failed={avatarFailed}
                  onError={markAvatarFailed}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 bg-[var(--color-panel)] border-[var(--color-border)]">
              {session.isAdmin && (
                <DropdownMenuItem asChild>
                  <Link href="/admin" className="cursor-pointer">管理后台</Link>
                </DropdownMenuItem>
              )}
              {session.isAdmin && <DropdownMenuSeparator />}
              {getAccountNavigationLinks(session.userId, !displayName).map((link) => (
                <DropdownMenuItem key={link.href} asChild>
                  <Link href={link.href as never} className="cursor-pointer flex items-center gap-1.5">
                    {link.label}
                    {link.needsProfile && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] flex-shrink-0" />}
                  </Link>
                </DropdownMenuItem>
              ))}
              {!session.isSuperAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/invite" className="cursor-pointer">使用邀请码</Link>
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
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
            style={{ fontFamily: "var(--font-mono)", letterSpacing: "var(--tracking-label)" }}
          >
            登录
          </Link>
        )}
      </div>
    );
  }

  return session ? (
    <>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <PlayerAvatar
          name={userLabel} size="sm"
          avatarUrl={avatarUrl}
          failed={avatarFailed}
          onError={markAvatarFailed}
        />
        <span className="text-sm text-[var(--color-fg-dim)] truncate">{userLabel}</span>
      </div>
      {session.isAdmin && <Link href="/admin" className="px-3 py-2 rounded-md text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel-hi)]">管理后台</Link>}
      {session.isAdmin && <div className="my-1 border-t border-[var(--color-border)]" />}
      {getAccountNavigationLinks(session.userId, !displayName).map((link) => (
        <Link key={link.href} href={link.href as never} className="px-3 py-2 rounded-md text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel-hi)] flex items-center gap-1.5">
          {link.label}
          {link.needsProfile && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] flex-shrink-0" />}
        </Link>
      ))}
      {!session.isSuperAdmin && (
        <>
          <div className="my-1 border-t border-[var(--color-border)]" />
          <Link href="/invite" className="px-3 py-2 rounded-md text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel-hi)]">使用邀请码</Link>
        </>
      )}
      <div className="my-1 border-t border-[var(--color-border)]" />
      <button
        onClick={() => void handleLogout()}
        className="text-left px-3 py-2 rounded-md text-sm text-[var(--color-danger)] hover:bg-[var(--color-panel-hi)]"
      >
        退出登录
      </button>
    </>
  ) : (
    <Link
      href="/login"
      className="px-3 py-2 rounded-md text-sm font-medium text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] hover:bg-[var(--color-panel-hi)]"
    >
      登录
    </Link>
  );
}
