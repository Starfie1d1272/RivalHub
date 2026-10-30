"use client";

import { usePathname } from "next/navigation";

export function HomeFiling() {
  const pathname = usePathname();
  if (pathname !== "/") return null;

  return (
    <div className="mt-2 text-center font-sans text-xs leading-5 tracking-normal text-[var(--color-fg-secondary)]">
      <a
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-sm hover:underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current"
      >
        苏ICP备2026083135号-1
      </a>
    </div>
  );
}
