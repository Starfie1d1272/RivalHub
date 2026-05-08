import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { checkAdminSession } from "@/lib/auth/session";
import { AdminNav } from "@/components/admin/AdminNav";

export default async function AdminSeasonLayout({
  children,
}: {
  children: ReactNode;
}) {
  const admin = await checkAdminSession();
  if (!admin) redirect("/admin/login");

  return (
    <div className="min-h-screen">
      <AdminNav email={admin.email} />
      {children}
    </div>
  );
}
