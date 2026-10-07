"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type AnchorHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type TeamProfileIdentity = { seasonSlug?: string | null; entryId?: string | null; slug?: string | null };
export function teamProfileHref({ seasonSlug, entryId, slug }: TeamProfileIdentity): string | null {
  if (seasonSlug && entryId) return `/${encodeURIComponent(seasonSlug)}/teams/${encodeURIComponent(entryId)}`;
  return slug ? `/teams/${encodeURIComponent(slug)}` : null;
}
export interface TeamProfileLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">, TeamProfileIdentity {
  children: ReactNode;
  profileHref?: string | null;
  variant?: "inherit" | "dense" | "subtle";
  stopPropagation?: boolean;
}
/** Event routes supply season context; cross-event surfaces pass an explicit identity/destination. */
export function TeamProfileLink(props: TeamProfileLinkProps) {
  if (props.seasonSlug || props.slug || props.profileHref || !props.entryId) return <ResolvedTeamProfileLink {...props} />;
  return <ContextualTeamProfileLink {...props} />;
}
function ContextualTeamProfileLink(props: TeamProfileLinkProps) {
  const params = useParams<{ seasonSlug?: string }>();
  return <ResolvedTeamProfileLink {...props} seasonSlug={params?.seasonSlug} />;
}
function ResolvedTeamProfileLink({ seasonSlug, entryId, slug, profileHref, children, variant = "inherit", stopPropagation = false, className, onClick, onKeyDown, ...props }: TeamProfileLinkProps) {
  const href = profileHref ?? teamProfileHref({ seasonSlug, entryId, slug });
  if (!href) return <span className={className}>{children}</span>;
  return <Link href={href as import("next").Route} className={cn(
    "transition-colors hover:text-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-2",
    variant === "dense" && "inline-flex min-h-6 min-w-6 items-center justify-center",
    variant === "subtle" && "text-[var(--color-fg-mid)]", className,
  )} onClick={event => { if (stopPropagation) event.stopPropagation(); onClick?.(event); }} onKeyDown={event => { if (stopPropagation) event.stopPropagation(); onKeyDown?.(event); }} {...props}>{children}</Link>;
}
