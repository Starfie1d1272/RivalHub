import { notFound } from "next/navigation";
import { eq, asc, inArray, and } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, matches, teams, matchMaps, demoImports } from "@/db/schema";
import { requireSeasonAdmin } from "@/lib/auth/session";
import { mapLabel } from "@/lib/maps";
import { DemoImportPanel } from "@/components/admin/DemoImportPanel";
import { DemoBatchImportPanel } from "@/components/admin/DemoBatchImportPanel";
import { RecomputeRatingsButton } from "@/components/admin/RecomputeRatingsButton";
import { MATCH_FORMAT_LABELS } from "@/types/match";
import Link from "next/link";

interface PageProps {
  params: Promise<{ seasonSlug: string }>;
}

export const dynamic = "force-dynamic";

export default async function AdminDemosPage({ params }: PageProps) {
  const { seasonSlug } = await params;

  const season = await db.query.seasons.findFirst({
    where: eq(seasons.slug, seasonSlug),
  });
  if (!season) notFound();
  await requireSeasonAdmin(season.id);

  const [allTeams, finishedMatches] = await Promise.all([
    db.query.teams.findMany({
      where: eq(teams.seasonId, season.id),
      orderBy: [asc(teams.name)],
    }),
    db.query.matches.findMany({
      where: and(
        eq(matches.seasonId, season.id),
        eq(matches.status, "finished"),
      ),
      orderBy: [asc(matches.completedAt)],
    }),
  ]);

  if (finishedMatches.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[var(--color-fg)]">
          Demo 导入 · {season.name}
        </h1>
        <p className="text-sm text-[var(--color-fg-dim)]">暂无已结束比赛</p>
      </div>
    );
  }

  const teamMap = new Map(allTeams.map((t) => [t.id, t.name]));

  const finishedMatchIds = finishedMatches.map((m) => m.id);
  const allMaps = await db.query.matchMaps.findMany({
    where: and(
      inArray(matchMaps.matchId, finishedMatchIds),
    ),
    orderBy: [asc(matchMaps.matchId), asc(matchMaps.mapOrder)],
  });

  // 查已导入的 mapId 集合（用 allMaps 的 id，不是 matchId）
  const importedMapIds = allMaps.length > 0
    ? await db
        .selectDistinct({ mapId: demoImports.mapId })
        .from(demoImports)
        .where(inArray(demoImports.mapId, allMaps.map((m) => m.id)))
        .then((rows) => new Set(rows.map((r) => r.mapId)))
    : new Set<string>();

  const mapsByMatch = new Map<string, typeof allMaps>();
  for (const map of allMaps) {
    const arr = mapsByMatch.get(map.matchId) ?? [];
    arr.push(map);
    mapsByMatch.set(map.matchId, arr);
  }

  // 组装 availableMaps 供批量导入面板使用
  const availableMaps = allMaps.map((mm) => {
    const match = finishedMatches.find((m) => m.id === mm.matchId)!;
    const teamAName = teamMap.get(match.teamAId) ?? "队伍 A";
    const teamBName = teamMap.get(match.teamBId) ?? "队伍 B";
    const dateStr = mm.completedAt
      ? mm.completedAt.toISOString().slice(0, 10)
      : (match.completedAt?.toISOString().slice(0, 10) ?? "未知日期");
    return {
      mapId: mm.id,
      label: `${teamAName} vs ${teamBName} · ${mm.mapName} · ${dateStr}`,
    };
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[var(--color-fg)]">
        Demo 导入 · {season.name}
      </h1>
      <p className="text-sm text-[var(--color-fg-dim)]">
        共 {finishedMatches.length} 场已结束比赛
      </p>

      {/* 批量导入折叠区域 */}
      <details className="rounded-lg border border-[var(--color-border)] overflow-hidden">
        <summary className="cursor-pointer px-4 py-3 bg-[var(--color-surface-raised)] font-medium text-sm select-none hover:bg-[var(--color-surface-hover)] transition-colors">
          批量导入 Demo
        </summary>
        <div className="px-4 py-4">
          <DemoBatchImportPanel seasonId={season.id} availableMaps={availableMaps} />
        </div>
      </details>

      {/* 基于当前不可变 ZIP 重建赛季 cohort */}
      <div className="flex justify-end gap-2 flex-wrap">
        <RecomputeRatingsButton seasonId={season.id} />
      </div>

      <div className="space-y-4">
        {finishedMatches.map((m) => {
          const maps = mapsByMatch.get(m.id) ?? [];
          if (maps.length === 0) return null;

          const teamAName = teamMap.get(m.teamAId) ?? "队伍 A";
          const teamBName = teamMap.get(m.teamBId) ?? "队伍 B";
          const isBO1 = m.format === "bo1";

          return (
            <div
              key={m.id}
              className="rounded-lg border border-[var(--color-border)] overflow-hidden"
            >
              {/* 比赛头部信息 */}
              <div className="flex items-center justify-between px-4 py-3 bg-[var(--color-surface-raised)]">
                <div className="flex items-center gap-3">
                  <Link
                    href={`/${seasonSlug}/matches/${m.id}`}
                    className="font-medium text-sm hover:text-[var(--color-accent)] transition-colors"
                  >
                    {teamAName} vs {teamBName}
                  </Link>
                  <span className="text-xs text-[var(--color-fg-mid)] font-mono">
                    {m.scoreA} : {m.scoreB}
                  </span>
                  <span className="text-xs text-[var(--color-fg-dim)]">
                    {MATCH_FORMAT_LABELS[m.format] ?? m.format.toUpperCase()}
                  </span>
                </div>
                <Link
                  href={`/${seasonSlug}/matches/${m.id}`}
                  className="text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors"
                >
                  查看比赛 →
                </Link>
              </div>

              {/* 地图列表 + 导入面板 */}
              <div className="divide-y divide-[var(--color-border)]">
                {maps.map((map) => {
                  const hasDemo = importedMapIds.has(map.id);
                  return (
                    <div key={map.id} className="px-4 py-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-mono text-xs text-[var(--color-fg-dim)]">
                          #{map.mapOrder}
                        </span>
                        <span className="text-sm font-medium">
                          {mapLabel(map.mapName)}
                        </span>
                        <span className="font-mono text-sm text-[var(--color-fg)]">
                          {map.scoreA != null ? `${map.scoreA} : ${map.scoreB}` : "—"}
                        </span>
                        {hasDemo && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-[color-mix(in srgb, var(--color-ok) 12%, transparent)] text-[var(--color-ok)]">
                            已导入
                          </span>
                        )}
                      </div>
                      <DemoImportPanel mapId={map.id} mapName={map.mapName} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
