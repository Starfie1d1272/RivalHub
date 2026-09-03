"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";

import { APP_BRAND } from "@/lib/branding";
import { OnlineCounter } from "./OnlineCounter";

export { getAccountNavigationLinks } from "./HeaderViewerClient";

interface HeaderClientProps {
  desktopNavigation: ReactNode;
  mobileNavigation: ReactNode;
  desktopViewer: ReactNode;
  mobileViewer: ReactNode;
}

export function HeaderClient({
  desktopNavigation,
  mobileNavigation,
  desktopViewer,
  mobileViewer,
}: HeaderClientProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

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

      <nav className="hidden sm:flex items-center justify-center gap-0.5 flex-wrap">
        {desktopNavigation}
      </nav>

      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center">
          <OnlineCounter />
        </div>
        {desktopViewer}
        <button
          className="sm:hidden p-2 text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"
          onClick={() => setMobileOpen((open) => !open)}
          aria-label="菜单"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {mobileOpen && (
        <div
          className="sm:hidden border-t border-[var(--color-border)] bg-[var(--color-panel)] px-4 py-3 flex flex-col gap-1"
          onClick={() => setMobileOpen(false)}
        >
          {mobileNavigation}
          <div className="mt-2 pt-2 border-t border-[var(--color-border)] flex flex-col gap-1">
            {mobileViewer}
          </div>
        </div>
      )}
    </header>
  );
}
