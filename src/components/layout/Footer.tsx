import Link from "next/link";
import { APP_BRAND } from "@/lib/branding";
import pkg from "@/../package.json";

export function Footer() {
  return (
    <footer
      className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between sm:items-center text-center sm:text-left"
      style={{
        padding: "20px 28px",
        borderTop: "1px solid var(--color-border)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--color-fg-dim)",
        letterSpacing: "var(--tracking-ticker)",
      }}
    >
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
        <span>PRIVACY</span>
        <span style={{ color: "var(--color-accent)" }}>{pkg.version}</span>
      </div>
    </footer>
  );
}
