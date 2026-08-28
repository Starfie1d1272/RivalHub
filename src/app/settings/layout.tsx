import { SettingsNav } from "@/components/settings/SettingsNav";

export default function SettingsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <main className="container mx-auto max-w-6xl px-4 py-8 sm:py-10">
    <div className="mb-5 lg:hidden"><SettingsNav /></div>
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
      <div className="min-w-0">{children}</div>
      <aside className="sticky top-6 hidden lg:block"><p className="mb-2 font-mono text-[11px] tracking-[0.14em] text-[var(--color-fg-mid)]">参赛资料导航</p><SettingsNav /></aside>
    </div>
  </main>;
}
