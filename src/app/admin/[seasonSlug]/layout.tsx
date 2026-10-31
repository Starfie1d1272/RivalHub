import { TelemetryScene } from "@/components/telemetry/ProductTelemetry";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { findAdminSeasonOverviewBySlug } from "@/lib/admin/season-context";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import Link from "next/link";
import { PageLayout } from "@/components/rivalhub";

export default function AdminSeasonLayout(props: {
  children: ReactNode;
  params: Promise<{ seasonSlug: string }>;
}) {
  return <Suspense fallback={<div className="p-8" role="status">正在加载赛事管理…</div>}><AdminSeasonContent {...props} /></Suspense>;
}

async function AdminSeasonContent({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ seasonSlug: string }>;
}) {
  const { seasonSlug } = await params;
  const season = await findAdminSeasonOverviewBySlug(seasonSlug);
  if (!season) notFound();

  const admin = await resolveAdminPageAccess(() => requireSeasonAdmin(season.id));
  if (!admin) return <AdminAccessDenied />;

  return (
    <PageLayout as="div" variant="workbench" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3 text-sm">
        <Link href={`/admin/${seasonSlug}`} className="font-semibold">{season.name}</Link>
        <Link href={`/${seasonSlug}`} className="text-[var(--color-fg-mid)]">查看公开赛事 ↗</Link>
      </div>
      <TelemetryScene prefix={`/admin/${seasonSlug}`} scene={season.competitionTemplate} eventId={season.id} />
      {children}
    </PageLayout>
  );
}
