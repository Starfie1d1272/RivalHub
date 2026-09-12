"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/my", label: "概览" },
  { href: "/my/teams", label: "我的队伍" },
  { href: "/my/competitions", label: "我的赛事" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/my" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function MyWorkspaceNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="个人工作区导航" className="flex flex-wrap gap-2 border-b border-[var(--color-border)] pb-2">
      {LINKS.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={[
              "border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2",
              active
                ? "border-[var(--color-accent)] text-[var(--color-fg)]"
                : "border-transparent text-[var(--color-fg-mid)] hover:border-[var(--color-border-hi)] hover:text-[var(--color-fg)]",
            ].join(" ")}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
