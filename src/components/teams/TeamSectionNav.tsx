import Link from "next/link";

export function TeamSectionNav({ active }: { active: "directory" | "recruitment" }) {
  return <nav aria-label="队伍页面" className="flex flex-wrap gap-2"><Link href="/teams" aria-current={active === "directory" ? "page" : undefined} className={active === "directory" ? "border border-[var(--color-accent-edge)] bg-[var(--color-accent-soft)] px-3 py-1.5 text-sm text-[var(--color-accent)]" : "border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-fg-mid)] hover:border-[var(--color-border-hi)]"}>队伍目录</Link><Link href="/teams/recruitment" aria-current={active === "recruitment" ? "page" : undefined} className={active === "recruitment" ? "border border-[var(--color-accent-edge)] bg-[var(--color-accent-soft)] px-3 py-1.5 text-sm text-[var(--color-accent)]" : "border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-fg-mid)] hover:border-[var(--color-border-hi)]"}>组队大厅</Link></nav>;
}
