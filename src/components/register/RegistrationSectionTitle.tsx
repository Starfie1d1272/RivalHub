import React, { type ReactNode } from "react";

interface RegistrationSectionTitleProps {
  children: ReactNode;
}

export function RegistrationSectionTitle({ children }: RegistrationSectionTitleProps) {
  return (
    <h2 className="text-lg font-semibold text-[var(--color-fg)] mb-4 pb-2 border-b border-[var(--color-border)]">
      {children}
    </h2>
  );
}
