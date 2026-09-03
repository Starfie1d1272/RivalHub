import type { ReactNode } from "react";

// Registration combines public season state with authenticated, viewer-specific
// entry/profile data. It is intentionally blocking rather than an instant
// Cache Components navigation target.
export const instant = false;

export default function RegistrationLayout({ children }: { children: ReactNode }) {
  return children;
}
