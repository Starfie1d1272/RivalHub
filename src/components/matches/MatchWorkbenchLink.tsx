"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";

/** Preserve the actual source view, including query filters and map anchors. */
export function MatchWorkbenchLink({ href, sourceAnchor, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string; sourceAnchor?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  if (typeof href !== "string" || !/^\/admin\/[^/]+\/matches\/[^/?#]+/.test(href)) return <Link href={href as never} {...props} />;
  const destination = new URL(href, "https://navigation.invalid");
  const query = search.toString();
  // Intra-workbench links must keep the original source, not point back to themselves.
  const source = /\/matches\/[^/]+$/.test(pathname) ? search.get("returnTo") : `${pathname}${query ? `?${query}` : ""}${sourceAnchor ? `#${sourceAnchor}` : ""}`;
  if (source) destination.searchParams.set("returnTo", source);
  return <Link href={`${destination.pathname}${destination.search}${destination.hash}` as never} {...props} />;
}
