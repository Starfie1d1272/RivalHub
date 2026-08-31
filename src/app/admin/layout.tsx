import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { checkAdminSession } from "@/lib/auth/session";
import { AdminSidebar } from "@/components/admin/AdminSidebar";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await checkAdminSession();
  if (!session) redirect("/login");
  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)]">
      <AdminSidebar email={session.email} role={session.role === "super_admin" ? "super_admin" : "season_admin"} />
      <main className="min-w-0">{children}</main>
    </div>
  );
}
