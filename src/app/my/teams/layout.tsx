import type { ReactNode } from "react";

// The Team workspace depends on the authenticated viewer and private invitation
// state, so it must not be validated as an instant Cache Components target.
export const instant = false;

export default function MyTeamsLayout({ children }: { children: ReactNode }) {
  return children;
}
