import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { AdminNav } from "@/components/admin/AdminNav";

export default async function AdminSeasonLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ seasonSlug: string }>;
}) {
  const { seasonSlug } = await params;
  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
    columns: { id: true },
  });
  if (!season) notFound();

  let admin;
  try {
    admin = await requireSeasonAdmin(season.id);
  } catch {
    redirect("/admin/login");
  }

  return (
    <div className="min-h-screen">
      <AdminNav email={admin.email} />
      {children}
    </div>
  );
}
