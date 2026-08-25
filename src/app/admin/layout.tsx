import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkAdminSession } from "@/lib/auth/session";
import { AdminSidebar } from "@/components/admin/AdminSidebar";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") ?? "";

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  const session = await checkAdminSession();
  if (!session) redirect("/admin/login");
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)]">
      <AdminSidebar email={session.email} />
      <main className="min-w-0">{children}</main>
    </div>
  );
}
