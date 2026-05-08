import Link from "next/link";
import { APP_BRAND } from "@/lib/branding";

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] py-6 mt-auto">
      <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-[var(--text-muted)]">
        <span>
          {APP_BRAND.footerLabel} · {new Date().getFullYear()}
        </span>
        <div className="flex items-center gap-4">
          <Link
            href="/seasons"
            className="hover:text-[var(--text-secondary)] transition-colors"
          >
            历史赛季
          </Link>
          <a
            href={APP_BRAND.repositoryUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-[var(--text-secondary)] transition-colors"
          >
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
