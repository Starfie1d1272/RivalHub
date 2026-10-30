import Link from "next/link";
import { Suspense } from "react";
import { HomeFiling } from "./HomeFiling";
import { APP_BRAND } from "@/lib/branding";
import pkg from "@/../package.json";

export function Footer() {
  return (
    <footer
      className="px-7 py-5"
      style={{
        borderTop: "1px solid var(--color-border)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--color-fg-dim)",
        letterSpacing: "var(--tracking-ticker)",
      }}
    >
      <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:pr-13 sm:text-left">
        <div>{APP_BRAND.name.toUpperCase()} · OPEN SOURCE ESPORTS TOURNAMENT PLATFORM</div>
        <div className="flex gap-3.5 flex-wrap justify-center">
          <a
            href={APP_BRAND.repositoryUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-[var(--color-fg)] transition-colors"
          >
            GITHUB ↗
          </a>
          <Link href="/rules" className="hover:text-[var(--color-fg)] transition-colors">
            RULES
          </Link>
          <Link href="/privacy" className="hover:text-[var(--color-fg)] transition-colors">
            PRIVACY
          </Link>
          <span style={{ color: "var(--color-accent)" }}>{pkg.version}</span>
        </div>
      </div>
      <Suspense fallback={null}>
        <HomeFiling />
      </Suspense>
    </footer>
  );
}
