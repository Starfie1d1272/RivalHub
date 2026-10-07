"use client";

import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { confirmMajorTournamentSeeds, saveMajorTournamentSeeds } from "@/actions/major-prestart";
import { Button } from "@/components/ui/button";
import { Marker, Panel } from "@/components/rivalhub";
import { formatCST } from "@/lib/utils/date";
import type { MajorPrestartPageData } from "@/lib/admin/season-workspace/types";
import { MajorRankingWorkspace, type RankingTeam } from "./MajorRankingWorkspace";

export type MajorTournamentSeedsManagementData = MajorPrestartPageData["seedManagement"];

type Management = MajorPrestartPageData["management"];

export function MajorTournamentSeedsManagement({ data, management }: { data: MajorTournamentSeedsManagementData; management: Management }) {
  const [isPending, startTransition] = useTransition();
  const capacity = data.entrants.length;
  const saved = [...data.seeds].sort((a, b) => a.tournamentSeed - b.tournamentSeed).map((seed) => seed.teamId);
  const recommendationOrder = data.recommendation?.teams.map((team) => team.teamId) ?? [];
  const initialOrder = saved.length === capacity ? saved : recommendationOrder.length === capacity
    ? recommendationOrder : data.entrants.map((entrant) => entrant.teamId);
  const initialOrderKey = initialOrder.join(",");
  const [seedStateKey, setSeedStateKey] = useState(initialOrderKey);
  const [order, setOrder] = useState<string[]>(initialOrder);
  if (seedStateKey !== initialOrderKey) {
    setSeedStateKey(initialOrderKey);
    setOrder(initialOrder);
  }
  const recommendation = data.recommendation;
  const recommendationReady = data.recommendationStatus === "ready";
  const confirmed = data.seedsConfirmed;
  const orderMatchesSaved = order.length === saved.length && order.every((teamId, index) => teamId === saved[index]);
  const teamById = useMemo(() => new Map(data.entrants.map((entrant) => [entrant.teamId, entrant])), [data.entrants]);
  const rosterById = new Map(management.rankingRoster.map((row) => [row.entryId, row.members]));
  const preliminaryById = new Map(management.qualification.run?.entrants.map((entrant) => [entrant.entryId, entrant]) ?? []);
  const referenceById = new Map(recommendation?.teams.map((team) => [team.teamId, team]) ?? []);
  const rankingTeams: RankingTeam[] = data.entrants.map((entrant) => {
    const reference = referenceById.get(entrant.teamId);
    const frozenStarters = new Map(reference?.starters.map((starter) => [starter.userId, starter]) ?? []);
    const preliminary = preliminaryById.get(entrant.teamId);
    return {
      entryId: entrant.teamId,
      teamName: entrant.teamName,
      systemRank: reference?.recommendationRank ?? null,
      tieState: reference?.tieState,
      members: (rosterById.get(entrant.teamId) ?? []).map((member) => ({ ...member, ...(member.isPrimaryStarter ? frozenStarters.get(member.userId) : undefined) })),
      preliminaryRank: preliminary?.preliminarySeed ?? null,
      route: preliminary?.route === "direct" ? "直通正赛" : preliminary?.route === "play-in" ? "Play-in 晋级" : undefined,
      result: preliminary?.route === "play-in" ? `${preliminary.wins}-${preliminary.losses}` : undefined,
    };
  });
  const cohortBoundaries = data.entryCohorts.filter((cohort) => cohort.toSeed < data.entrantCapacity)
    .map((cohort) => ({ after: cohort.toSeed, label: `进入 ${cohort.stageName} / 下一批次` }));
  const save = () => startTransition(async () => {
    const result = await saveMajorTournamentSeeds({ seasonId: data.seasonId, entryIds: order });
    if (!result.success) toast.error(result.error.message);
    else toast.success("最终种子排序已保存，需重新确认");
  });

  return <Panel label={`正式种子 · ${data.entrantCapacity} 支队伍`}>
    {!data.entrantsLocked ? <p className="text-sm text-[var(--color-fg-mid)]">冻结正式名单后，才能保存最终种子。</p> : <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Marker sub={confirmed ? "当前排序已确认" : data.seeds.length > 0 ? "排序待确认" : "尚未保存排序"}>{confirmed ? "种子已确认" : "种子待确认"}</Marker>
          <p className="mt-1 text-sm text-[var(--color-fg-mid)]">系统参考在名单锁定时固定；原预排和资格赛结果用于对照，不会自动继承为最终种子。</p>
          {recommendation && <p className="text-xs text-[var(--color-fg-mid)]">系统参考生成于 {formatCST(recommendation.generatedAt)}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={isPending || confirmed || !recommendationReady || order.length !== capacity || orderMatchesSaved} onClick={save}>保存排序</Button>
          <Button disabled={isPending || !recommendationReady || confirmed || data.seeds.length !== capacity || !orderMatchesSaved} onClick={() => startTransition(async () => {
            const result = await confirmMajorTournamentSeeds({ seasonId: data.seasonId });
            if (!result.success) toast.error(result.error.message); else toast.success("最终种子已确认");
          })}>确认最终种子</Button>
        </div>
      </div>
      {data.recommendationStatus !== "ready" && <p className="border border-[var(--color-warn)] px-3 py-2 text-sm text-[var(--color-warn)]">
        {data.recommendationStatus === "missing" ? "冻结正式名单后才会生成系统参考。" : "系统参考与当前冻结名单不一致，已停止用于最终种子。"}
      </p>}
      <MajorRankingWorkspace mode="final" teams={rankingTeams} order={order} onOrderChange={confirmed ? undefined : setOrder} platform={recommendation?.platform ?? management.strengthPreview.platform} cohortBoundaries={cohortBoundaries} />
      <section aria-labelledby="major-first-round-preview-title"><h3 id="major-first-round-preview-title" className="font-medium text-[var(--color-fg)]">{data.firstSwissStageName} 首轮预览</h3>{data.firstRound ? <ol className="mt-2 grid gap-2 text-sm md:grid-cols-2">{data.firstRound.map((pairing) => <li key={`${pairing.higherSeed}-${pairing.lowerSeed}`} className="border border-[var(--color-border)] px-3 py-2">#{pairing.higherSeed} <TeamProfileLink entryId={data.seeds.find((seed) => seed.tournamentSeed === pairing.higherSeed)?.teamId}>{teamById.get(data.seeds.find((seed) => seed.tournamentSeed === pairing.higherSeed)?.teamId ?? "")?.teamName}</TeamProfileLink> vs #{pairing.lowerSeed} <TeamProfileLink entryId={data.seeds.find((seed) => seed.tournamentSeed === pairing.lowerSeed)?.teamId}>{teamById.get(data.seeds.find((seed) => seed.tournamentSeed === pairing.lowerSeed)?.teamId ?? "")?.teamName}</TeamProfileLink> · {pairing.format.toUpperCase()}</li>)}</ol> : <p className="mt-1 text-sm text-[var(--color-fg-mid)]">需先保存完整种子才能构造预览。</p>}<p className="mt-2 text-sm text-[var(--color-fg-mid)]">保存种子前不会创建比赛。</p></section>
    </div>}
  </Panel>;
}
