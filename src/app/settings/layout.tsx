import React from "react";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { PageLayout } from "@/components/rivalhub";

// Settings reads the signed-in user's session and private profile data.
export const instant = false;

export default function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <PageLayout as="main" variant="wide" className="sm:py-10">
    <div className="mb-5 lg:hidden"><SettingsNav /></div>
    <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
      <aside className="sticky top-6 hidden lg:block"><p className="mb-2 font-mono text-[11px] tracking-[0.14em] text-[var(--color-fg-mid)]">参赛资料导航</p><SettingsNav /></aside>
      <div className="min-w-0">{children}</div>
    </div>
  </PageLayout>;
}
