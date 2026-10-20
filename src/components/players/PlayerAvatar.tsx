"use client";

import Image from "next/image";
import React, { useState } from "react";
import { cn } from "@/lib/utils/cn";

const sizes = { sm: { pixels: 32, className: "size-8 text-sm" }, md: { pixels: 40, className: "size-10 text-base" }, lg: { pixels: 96, className: "size-24 text-2xl" } } as const;

/** DB-only presentation. Header can retain failure state above menu remounts. */
export function PlayerAvatar({ name, avatarUrl, hasActivePublicSanction = false, size = "md", failed = false, onError, className }: {
  name: string;
  avatarUrl?: string | null;
  hasActivePublicSanction?: boolean;
  size?: keyof typeof sizes;
  failed?: boolean;
  onError?: () => void;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const style = sizes[size];
  const classes = cn("inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-panel-hi)] font-semibold text-[var(--color-fg-mid)] object-cover", style.className, className);
  const avatar = avatarUrl && !failed && avatarUrl !== failedUrl
    ? <Image src={avatarUrl} alt={hasActivePublicSanction ? "" : name} width={style.pixels} height={style.pixels} className={classes} referrerPolicy="no-referrer" unoptimized onError={() => { setFailedUrl(avatarUrl); onError?.(); }} />
    : <span role={hasActivePublicSanction ? undefined : "img"} aria-label={hasActivePublicSanction ? undefined : name} className={classes}>{name.trim().charAt(0).toUpperCase() || "?"}</span>;
  if (!hasActivePublicSanction) return avatar;
  const label = `${name} · 当前存在赛事纪律处罚`;
  return <span role="img" aria-label={label} title={label} className={cn("relative inline-flex shrink-0 align-middle [container-type:inline-size]", style.className, className)}>
    <span aria-hidden="true" className="contents">{avatar}</span>
    <span aria-hidden="true" className="pointer-events-none absolute inset-x-[-18.75%] top-1/2 inline-flex h-1/2 -translate-y-1/2 rotate-[-30deg] items-center justify-center whitespace-nowrap bg-[var(--color-danger)] text-[31.25cqw] font-bold leading-none text-white shadow-sm">
      已禁赛
    </span>
  </span>;
}
