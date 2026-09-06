import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { InviteManager } from "@/components/admin/InviteManager";
import { getAdminInviteHistory, normalizeAdminInviteQuery } from "@/lib/admin/invites";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminInvitesPage({ searchParams }: PageProps) {
  if (!(await resolveAdminPageAccess(requireSuperAdmin))) return <AdminAccessDenied />;

  const query = normalizeAdminInviteQuery(await searchParams);
  const [history, seasonRows] = await Promise.all([
    getAdminInviteHistory(query),
    db
      .select({ id: seasons.id, name: seasons.name, slug: seasons.slug })
      .from(seasons)
      .orderBy(asc(seasons.createdAt)),
  ]);

  return (
    <PageLayout as="div" variant="narrow">
      <PageHeader title="邀请码管理" />
      <InviteManager history={history} seasons={seasonRows} />
    </PageLayout>
  );
}
