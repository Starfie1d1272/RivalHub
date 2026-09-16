"use client";

import React, { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils/cn";

interface TeamLogoImageProps {
  logoUrl: string | null;
  teamName: string;
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
  imageClassName?: string;
  fallbackClassName?: string;
}

/** 队伍自有图标的统一展示入口；公开存储图标直接加载，绕过 Vercel 图片优化服务。 */
export function TeamLogoImage({
  logoUrl,
  teamName,
  fill = false,
  width = 64,
  height = 64,
  sizes,
  imageClassName,
  fallbackClassName,
}: TeamLogoImageProps) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const initial = teamName.trim()[0]?.toUpperCase() ?? "?";
  const resolvedLogoUrl = logoUrl && logoUrl !== failedLogoUrl ? logoUrl : null;

  if (!resolvedLogoUrl) {
    return (
      <span
        role="img"
        aria-label={`${teamName}的队伍图标`}
        className={cn("flex h-full w-full items-center justify-center font-bold text-[var(--color-fg-dim)]", fallbackClassName)}
      >
        {initial}
      </span>
    );
  }

  const onError = () => setFailedLogoUrl(resolvedLogoUrl);
  return fill ? (
    <Image
      src={resolvedLogoUrl}
      alt={`${teamName}的队伍图标`}
      fill
      sizes={sizes}
      className={imageClassName}
      unoptimized
      onError={onError}
    />
  ) : (
    <Image
      src={resolvedLogoUrl}
      alt={`${teamName}的队伍图标`}
      width={width}
      height={height}
      sizes={sizes}
      className={imageClassName}
      unoptimized
      onError={onError}
    />
  );
}
