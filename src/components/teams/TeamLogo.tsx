import React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils/cn";

export function TeamLogo({
  logoUrl,
  teamName,
  size = "sm",
  className,
}: {
  logoUrl: string | null;
  teamName: string;
  size?: "sm" | "lg";
  className?: string;
}) {
  const initial = teamName.trim()[0]?.toUpperCase() ?? "?";
  const dimensions = size === "lg" ? "h-20 w-20" : "h-10 w-10";

  return (
    <div className={cn("relative shrink-0 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-panel-low)]", dimensions, className)}>
      {logoUrl ? (
        <Image src={logoUrl} alt={`${teamName} logo`} fill sizes={size === "lg" ? "80px" : "40px"} className="object-cover" />
      ) : (
        <span className={cn("flex h-full w-full items-center justify-center font-bold text-[var(--color-fg-dim)]", size === "lg" ? "text-2xl" : "text-sm")}>
          {initial}
        </span>
      )}
    </div>
  );
}
