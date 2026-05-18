import React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  primary?: boolean;
  ghost?: boolean;
  danger?: boolean;
  full?: boolean;
  small?: boolean;
  asChild?: boolean;
}

export function Btn({
  children,
  primary,
  ghost,
  danger,
  full,
  small,
  asChild,
  className,
  disabled,
  ...props
}: BtnProps) {
  let variant: "default" | "destructive" | "ghost" | "outline" = "outline";
  if (primary) variant = "default";
  if (ghost) variant = "ghost";
  if (danger) variant = "destructive";

  return (
    <Button
      variant={variant}
      size={small ? "sm" : "default"}
      disabled={disabled}
      asChild={asChild}
      className={cn(
        full && "w-full",
        "rounded-sm",
        "font-[family-name:var(--font-sans)]",
        className
      )}
      {...props}
    >
      {children}
    </Button>
  );
}
