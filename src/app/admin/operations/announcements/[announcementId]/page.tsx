import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { AnnouncementForm } from "@/components/admin/AnnouncementForm";
import { PageHeader, PageLayout } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { getAnnouncementForAdmin } from "@/lib/announcements/read-model";

export default async function EditAnnouncementPage({
  params,
}: {
  params: Promise<{ announcementId: string }>;
}) {
  const admin = await resolveAdminPageAccess(requireAdmin);
  if (!admin) return <AdminAccessDenied />;
  const role = admin.role === "super_admin" ? "super_admin" as const : "season_admin" as const;
  const { announcementId } = await params;

  const [announcement, seasonRows] = await Promise.all([
    getAnnouncementForAdmin(announcementId, { role, seasonIds: admin.seasonIds }),
    db
      .select({ id: seasons.id, name: seasons.name })
      .from(seasons)
      .where(role === "super_admin" ? undefined : admin.seasonIds.length ? inArray(seasons.id, admin.seasonIds) : inArray(seasons.id, [] as string[]))
      .orderBy(asc(seasons.name)),
  ]);

  if (!announcement) notFound();

  return (
    <PageLayout variant="standard" className="space-y-6">
      <PageHeader
        title="编辑公告"
        description="修改公告正文与设置；已发布公告保存后仍保持已发布状态。"
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/operations/announcements">返回列表</Link>
          </Button>
        }
      />
      <AnnouncementForm
        initialData={announcement}
        announcementId={announcement.id}
        isEditing
        seasons={seasonRows}
        canManageSite={role === "super_admin"}
      />
    </PageLayout>
  );
}
