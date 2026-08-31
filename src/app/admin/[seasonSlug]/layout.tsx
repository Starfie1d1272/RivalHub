import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { SeasonSubNav } from "@/components/admin/SeasonSubNav";

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
    columns: {
      id: true,
      hasCaptainVoting: true,
      hasDraft: true,
      stagePlan: true,
      status: true,
    },
  });
  if (!season) notFound();

  let admin;
  try {
    admin = await requireSeasonAdmin(season.id);
  } catch {
    redirect("/admin/login");
  }

  const hasMatches = season.stagePlan.length > 0;
  const isSuperAdmin = admin.role === "super_admin";

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <SeasonSubNav
        seasonSlug={seasonSlug}
        hasCaptainVoting={season.hasCaptainVoting}
        hasDraft={season.hasDraft}
        hasMatches={hasMatches}
        showSettings={isSuperAdmin}
      />
      {children}
    </div>
  );
}
