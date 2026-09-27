"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { lockMajorPrestartEntrants } from "@/actions/major-prestart";
import { Button } from "@/components/ui/button";
import { Marker, Panel } from "@/components/rivalhub";
import type { MajorPrestartPageData } from "@/lib/admin/season-workspace/types";
import { MajorRankingWorkspace } from "./MajorRankingWorkspace";

export type MajorPrestartManagementData = MajorPrestartPageData["management"];

export function MajorLiveRanking({ data }: { data: MajorPrestartManagementData }) {
  const referenceById = new Map(data.strengthPreview.teams.map((team) => [team.teamId, team]));
  const rosterById = new Map(data.rankingRoster.map((row) => [row.entryId, row.members]));
  const teams = data.approvedCandidates.map((candidate) => ({
    entryId: candidate.id,
    teamName: candidate.name,
    systemRank: referenceById.get(candidate.id)?.recommendationRank ?? null,
    tieState: referenceById.get(candidate.id)?.tieState,
    members: rosterById.get(candidate.id) ?? [],
  }));
  return <Panel label={`报名队伍实力参考 · ${teams.length} 支`}>
    {data.strengthPreview.status !== "ready" && <p className="mb-3 text-sm text-[var(--color-warn)]">{data.strengthPreview.blockers.join(" ")}</p>}
    <MajorRankingWorkspace mode="reference" teams={teams} order={data.initialPreliminaryOrderEntryIds} platform={data.strengthPreview.platform} />
    {data.pendingReviewCount > 0 && <p className="mt-3 text-sm text-[var(--color-warn)]">仍有 {data.pendingReviewCount} 支队伍待审核、补正或处理候补。</p>}
  </Panel>;
}

export function MajorPrestartManagement({ data }: { data: MajorPrestartManagementData }) {
  const [pending, startTransition] = useTransition();
  const rosterById = new Map(data.rankingRoster.map((row) => [row.entryId, row.members]));
  const referenceById = new Map(data.strengthPreview.teams.map((team) => [team.teamId, team]));
  const teams = data.entrants.map((entrant) => ({
    entryId: entrant.teamId,
    teamName: entrant.teamName,
    systemRank: referenceById.get(entrant.teamId)?.recommendationRank ?? null,
    members: rosterById.get(entrant.teamId) ?? [],
    route: `${entrant.rosterStatus === "frozen" ? "名单已冻结" : entrant.rosterStatus === "confirmed" ? "名单已确认" : "待重新审核"} · 学籍待补 ${entrant.roster.filter((member) => !member.educationVerified).length} 人`,
  }));
  const order = teams.slice().sort((a, b) => (a.systemRank ?? Number.MAX_SAFE_INTEGER) - (b.systemRank ?? Number.MAX_SAFE_INTEGER) || a.teamName.localeCompare(b.teamName))
    .map((team) => team.entryId);
  const needsReview = data.entrants.filter((entrant) => entrant.rosterStatus !== "confirmed" && entrant.rosterStatus !== "frozen").length;
  const missingEducation = data.entrants.reduce((count, entrant) => count + entrant.roster.filter((member) => !member.educationVerified).length, 0);
  const changedRosters = data.entrants.filter((entrant) => entrant.recentRosterChange);
  const deadlinePending = !data.rosterAdjustmentDeadlinePassed;
  return <Panel label={`正赛名单 · ${data.entrants.length}/${data.entrantCapacity}`}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <Marker sub={data.entrantsLocked ? "正式名单已经冻结" : "资格赛完成后确认正式参赛队，再完成名单调整与审核"}>
          {data.entrantsLocked ? "最终名单已锁定" : "最终名单调整"}
        </Marker>
        <p className="mt-1 text-sm text-[var(--color-fg-mid)]">待确认名单 {needsReview} 支 · 学籍资料待补全 {missingEducation} 人。名单变更由队长和成员在报名入口发起，并重新审核。</p>
        <p className="mt-1 text-xs text-[var(--color-fg-mid)]">最终调整截止：{data.rosterChangeClosesAt ? new Date(data.rosterChangeClosesAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "尚未设置"}</p>
      </div>
      {!data.entrantsLocked && <Button disabled={pending || deadlinePending || data.entrants.length !== data.entrantCapacity || needsReview > 0 || missingEducation > 0} onClick={() => startTransition(async () => {
        const result = await lockMajorPrestartEntrants({ seasonId: data.seasonId });
        if (!result.success) toast.error(result.error.message); else toast.success("正式参赛队和最终名单已冻结");
      })}>冻结正式名单</Button>}
    </div>
    {changedRosters.length > 0 && <details className="mb-4 border border-[var(--color-border)] px-3 py-2 text-sm">
      <summary className="cursor-pointer">最近已审核名单变化 · {changedRosters.length} 支队伍</summary>
      <ul className="mt-2 space-y-1 text-[var(--color-fg-mid)]">{changedRosters.map((entrant) => <li key={entrant.id}>
        <strong>{entrant.teamName}</strong>{entrant.recentRosterChange!.added.length > 0 ? ` · 加入 ${entrant.recentRosterChange!.added.join("、")}` : ""}{entrant.recentRosterChange!.removed.length > 0 ? ` · 离开 ${entrant.recentRosterChange!.removed.join("、")}` : ""}{entrant.recentRosterChange!.primaryChanged.length > 0 ? ` · 主力调整 ${entrant.recentRosterChange!.primaryChanged.join("、")}` : ""}
      </li>)}</ul>
    </details>}
    {teams.length > 0 ? <MajorRankingWorkspace mode="reference" teams={teams} order={order} platform={data.strengthPreview.platform} /> : <p className="text-sm text-[var(--color-fg-mid)]">先确认并同步正赛参赛队。</p>}
  </Panel>;
}
