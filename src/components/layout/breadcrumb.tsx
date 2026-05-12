import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav
      aria-label="面包屑"
      className="flex items-center gap-1.5 text-sm text-[var(--color-fg-dim)]"
    >
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        return (
          <span key={idx} className="flex items-center gap-1.5">
            {idx > 0 && <ChevronRight size={14} className="opacity-60" />}
            {item.href && !isLast ? (
              <Link
                href={item.href as never}
                className="hover:text-[var(--color-fg)] transition-colors"
              >
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "text-[var(--color-fg-mid)]" : ""}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
