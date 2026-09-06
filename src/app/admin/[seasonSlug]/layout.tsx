import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { SeasonSubNav } from "@/components/admin/SeasonSubNav";
import { PageLayout } from "@/components/rivalhub";

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
      registrationMode: true,
      hasCaptainVoting: true,
      hasDraft: true,
      hasCommunityAwards: true,
      stagePlan: true,
      status: true,
    },
  });
  if (!season) notFound();

  const admin = await resolveAdminPageAccess(() => requireSeasonAdmin(season.id));
  if (!admin) return <AdminAccessDenied />;

  const hasMatches = season.stagePlan.length > 0;
  const isSuperAdmin = admin.role === "super_admin";

  return (
    <PageLayout as="div" variant="workbench" className="space-y-6">
      <SeasonSubNav
        seasonSlug={seasonSlug}
        registrationMode={season.registrationMode}
        hasCaptainVoting={season.hasCaptainVoting}
        hasDraft={season.hasDraft}
        hasCommunityAwards={season.hasCommunityAwards}
        hasMatches={hasMatches}
        showSettings={isSuperAdmin}
      />
      {children}
    </PageLayout>
  );
}
