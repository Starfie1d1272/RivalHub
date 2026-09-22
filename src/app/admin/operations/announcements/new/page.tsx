import Link from "next/link";
import { asc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AnnouncementForm } from "@/components/admin/AnnouncementForm";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";

export default async function NewAnnouncementPage() {
  const admin = await resolveAdminPageAccess(requireAdmin);
  if (!admin) return <AdminAccessDenied />;
  const role = admin.role === "super_admin" ? "super_admin" as const : "season_admin" as const;

  const seasonRows = await db
    .select({ id: seasons.id, name: seasons.name })
    .from(seasons)
    .where(role === "super_admin" ? undefined : admin.seasonIds.length ? inArray(seasons.id, admin.seasonIds) : inArray(seasons.id, [] as string[]))
    .orderBy(asc(seasons.name));

  return (
    <PageLayout variant="standard" className="space-y-6">
      <PageHeader
        title="新建公告"
        description="正文支持 Markdown；草稿不会出现在公开页面。"
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/operations/announcements">返回列表</Link>
          </Button>
        }
      />
      <AnnouncementForm
        seasons={seasonRows}
        canManageSite={role === "super_admin"}
      />
    </PageLayout>
  );
}
