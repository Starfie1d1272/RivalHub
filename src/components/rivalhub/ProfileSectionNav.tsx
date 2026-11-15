import Link from "next/link";
import type { Route } from "next";

/** Task navigation for public profiles; metric families stay inside Statistics. */
export function ProfileSectionNav({
  label,
  items,
}: {
  label: string;
  items: readonly { label: string; href: string; active: boolean }[];
}) {
  return (
    <nav
      aria-label={label}
      className="flex min-w-0 gap-5 border-b border-[var(--color-border)] sm:gap-7"
    >
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href as Route}
          prefetch={false}
          scroll={false}
          aria-current={item.active ? "page" : undefined}
          className={`inline-flex min-h-12 items-center border-b-2 py-3 text-sm ${item.active ? "border-[var(--color-accent)] font-semibold text-[var(--color-fg)]" : "border-transparent text-[var(--color-fg-mid)] hover:text-[var(--color-fg)]"}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
