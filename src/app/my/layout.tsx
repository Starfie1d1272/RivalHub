import type { ReactNode } from "react";

// The personal area is authenticated and request-bound. Keep its blocking
// behavior local to this private route tree.
export const instant = false;

export default function MyLayout({ children }: { children: ReactNode }) {
  return children;
}
