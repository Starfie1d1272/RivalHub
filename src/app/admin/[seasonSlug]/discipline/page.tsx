import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { resolveAdminPageAccess } from "@/lib/auth/admin-access";
import { getSeasonSanctions } from "@/actions/discipline";
import { DisciplineManagement } from "@/components/admin/DisciplineManagement";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { ErrorState, PageHeader } from "@/components/rivalhub";
import { normalizeDisciplineAdminQuery } from "@/lib/discipline/admin-review";
import type { DisciplineAdminSearchParams } from "@/lib/discipline/admin-review-contract";

/**
 * 赛事级个人纪律处罚管理。只处理个人 sanction 事实——不触达队伍、
 * 比赛结果、最终排名或荣誉；全部状态流转复用现有 discipline actions。
 */
export default async function AdminDisciplinePage({
  params,
  searchParams,
}: {
  params: Promise<{ seasonSlug: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { seasonSlug } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
    columns: { id: true, name: true },
  });
  if (!season) notFound();

  if (!(await resolveAdminPageAccess(() => requireSeasonAdmin(season.id)))) {
    return <AdminAccessDenied />;
  }

  const query: DisciplineAdminSearchParams = await searchParams ?? {};
  const result = await getSeasonSanctions(season.id, normalizeDisciplineAdminQuery(query));
  if (!result.success) {
    return (
      <div className="space-y-6">
        <PageHeader title={`纪律处罚管理 · ${season.name}`} />
        <ErrorState
          code={result.error.code}
          title="无法加载纪律处罚记录"
          sub={result.error.message}
        />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title={`纪律处罚管理 · ${season.name}`}
        description="个人处罚只对被处罚用户本人、在指定生效窗口内拦截对应能力，不连带队伍或历史事实。"
      />
      <DisciplineManagement
        seasonId={season.id}
        seasonSlug={seasonSlug}
        sanctions={result.data.rows}
        total={result.data.total}
        page={result.data.page}
        pageSize={result.data.pageSize}
        totalPages={result.data.totalPages}
        normalizedQuery={result.data.normalizedQuery}
        hasAnyRecords={result.data.hasAnyRecords}
      />
    </div>
  );
}
