import React from "react";
import { cn } from "@/lib/utils/cn";
import { TeamLogoImage } from "./TeamLogoImage";

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
  const dimensions = size === "lg" ? "h-20 w-20" : "h-10 w-10";

  return (
    <div className={cn("relative shrink-0 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-panel-low)]", dimensions, className)}>
      <TeamLogoImage
        logoUrl={logoUrl}
        teamName={teamName}
        fill
        sizes={size === "lg" ? "80px" : "40px"}
        imageClassName="object-cover"
        fallbackClassName={size === "lg" ? "text-2xl" : "text-sm"}
      />
    </div>
  );
}
