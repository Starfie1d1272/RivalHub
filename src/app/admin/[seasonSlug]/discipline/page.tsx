import { notFound, redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasonRegistrations, seasons, users } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { getSeasonSanctions } from "@/actions/discipline";
import { DisciplineManagement, type DisciplineSanctionRow, type DisciplineSubjectOption } from "@/components/admin/DisciplineManagement";

export const dynamic = "force-dynamic";

/**
 * 赛事级个人纪律处罚管理。只处理个人 sanction 事实——不触达队伍、
 * 比赛结果、最终排名或荣誉；全部状态流转复用现有 discipline actions。
 */
export default async function AdminDisciplinePage({
  params,
}: {
  params: Promise<{ seasonSlug: string }>;
}) {
  const { seasonSlug } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
    columns: { id: true, name: true },
  });
  if (!season) notFound();

  try {
    await requireSeasonAdmin(season.id);
  } catch {
    redirect("/admin/login");
  }

  const result = await getSeasonSanctions(season.id);
  const rows = result.success ? result.data : [];

  const subjectIds = [...new Set(rows.map((row) => row.subjectUserId))];
  const [sanctionedUsers, registeredUsers] = await Promise.all([
    subjectIds.length > 0
      ? db
          .select({ id: users.id, displayName: users.displayName, steamName: users.steamName, email: users.email })
          .from(users)
          .where(inArray(users.id, subjectIds))
      : Promise.resolve([]),
    db
      .select({ id: users.id, displayName: users.displayName, steamName: users.steamName, email: users.email })
      .from(seasonRegistrations)
      .innerJoin(users, eq(seasonRegistrations.userId, users.id))
      .where(eq(seasonRegistrations.seasonId, season.id)),
  ]);

  const labelFor = (u: { displayName: string | null; steamName: string | null; email: string }) =>
    u.displayName ?? u.steamName ?? u.email;

  const sanctions: DisciplineSanctionRow[] = rows.map((row) => {
    const user = sanctionedUsers.find((u) => u.id === row.subjectUserId);
    return {
      id: row.id,
      subjectUserId: row.subjectUserId,
      subjectLabel: user ? labelFor(user) : row.subjectUserId,
      storedStatus: row.status,
      resolvedStatus: row.resolvedStatus,
      effects: [...(row.effects ?? [])],
      internalEvidence: row.internalEvidence,
      publicExplanation: row.publicExplanation,
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveUntil: row.effectiveUntil?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      revocationReason: row.revocationReason,
      createdAt: row.createdAt.toISOString(),
    };
  });

  const subjectById = new Map<string, DisciplineSubjectOption>();
  for (const u of registeredUsers) {
    subjectById.set(u.id, { id: u.id, label: labelFor(u), detail: u.email });
  }
  for (const u of sanctionedUsers) {
    if (!subjectById.has(u.id)) {
      subjectById.set(u.id, { id: u.id, label: labelFor(u), detail: u.email });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-fg)]">纪律处罚管理 · {season.name}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
          个人处罚只对被处罚用户本人、在指定生效窗口内拦截对应能力，不连带队伍或历史事实。
        </p>
      </div>
      <DisciplineManagement
        seasonId={season.id}
        sanctions={sanctions}
        subjects={[...subjectById.values()]}
      />
    </div>
  );
}
