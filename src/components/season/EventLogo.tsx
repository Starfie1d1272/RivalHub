"use client";

import Image from "next/image";
import React, { useState } from "react";

/** Optional public event mark; missing/broken images never replace event identity. */
export function EventLogo({ logoUrl, className }: { logoUrl: string | null; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!logoUrl || logoUrl === failedUrl) return null;
  return <Image src={logoUrl} alt="赛事 Logo" width={64} height={64} unoptimized className={className ?? "h-16 w-16 shrink-0 object-contain"} onError={() => setFailedUrl(logoUrl)} />;
}
