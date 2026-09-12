import type { ReactNode } from "react";
import { PageLayout } from "@/components/rivalhub";
import { MyWorkspaceNav } from "@/components/my/MyWorkspaceNav";

// The personal area is authenticated and request-bound. Keep its blocking
// behavior local to this private route tree.
export const instant = false;

export default function MyLayout({ children }: { children: ReactNode }) {
  return <PageLayout as="div" variant="wide" className="space-y-6"><MyWorkspaceNav />{children}</PageLayout>;
}
