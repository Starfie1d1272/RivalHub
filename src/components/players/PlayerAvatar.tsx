"use client";

import Image from "next/image";
import React, { useState } from "react";
import { cn } from "@/lib/utils/cn";

const sizes = { sm: { pixels: 32, className: "size-8 text-sm" }, md: { pixels: 40, className: "size-10 text-base" }, lg: { pixels: 96, className: "size-24 text-2xl" } } as const;

/** DB-only presentation. Header can retain failure state above menu remounts. */
export function PlayerAvatar({ name, avatarUrl, size = "md", failed = false, onError, className }: {
  name: string;
  avatarUrl?: string | null;
  size?: keyof typeof sizes;
  failed?: boolean;
  onError?: () => void;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const style = sizes[size];
  const classes = cn("inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-panel-hi)] font-semibold text-[var(--color-fg-mid)] object-cover", style.className, className);
  if (avatarUrl && !failed && avatarUrl !== failedUrl) return <Image src={avatarUrl} alt={name} width={style.pixels} height={style.pixels} className={classes} referrerPolicy="no-referrer" onError={() => { setFailedUrl(avatarUrl); onError?.(); }} />;
  return <span role="img" aria-label={name} className={classes}>{name.trim().charAt(0).toUpperCase() || "?"}</span>;
}
