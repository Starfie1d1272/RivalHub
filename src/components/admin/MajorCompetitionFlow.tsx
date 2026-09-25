"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  configureCompetitionQualification,
  generateCompetitionQualificationRound,
  resetCompetitionQualification,
  saveCompetitionQualificationRank,
} from "@/actions/competition-qualification";
import { selectMajorEntrants, setMajorManagedProfile } from "@/actions/major-prestart";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InlineConfirm, Marker, Panel } from "@/components/rivalhub";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deriveCompetitionQualificationPlan, isShortSwissQualificationAllowed, SHORT_SWISS_DISABLED_NOTE, type CompetitionQualificationFormat } from "@/lib/competition-qualification/policy";
import type { MajorPrestartPageData } from "@/lib/admin/season-workspace/types";
import type { ActionResult } from "@/types/action";

type ManagementData = MajorPrestartPageData["management"];

async function reportResult(work: () => Promise<ActionResult<void>>, success: string): Promise<void> {
  const result = await work();
  if (result.success) toast.success(success);
  else toast.error(result.error.message);
}

export function MajorCompetitionFlow({ data }: { data: ManagementData }) {
  const [pending, startTransition] = useTransition();
  const [format, setFormat] = useState<CompetitionQualificationFormat>("direct_bo3");
  const [order, setOrder] = useState(data.initialPreliminaryOrderEntryIds);
  const [confirmReset, setConfirmReset] = useState(false);
  const candidatesById = useMemo(() => new Map(data.approvedCandidates.map((candidate) => [candidate.id, candidate])), [data.approvedCandidates]);

  const plan = useMemo(() => {
    try {
      return deriveCompetitionQualificationPlan(data.approvedCandidateCount, data.entrantCapacity);
    } catch {
      return null;
    }
  }, [data.approvedCandidateCount, data.entrantCapacity]);
  const shortSwissAllowed = Boolean(plan && isShortSwissQualificationAllowed(plan.playInEntryCount));
  const canConfigure = data.seasonStatus === "registration" && data.registrationClosed && !data.qualification.run &&
    data.pendingReviewCount === 0 && plan !== null && data.approvedCandidates.length === data.approvedCandidateCount &&
    order.length === data.approvedCandidateCount;
  const run = data.qualification.run;
  const finalEntryIds = run?.completedAt
    ? run.entrants.filter((entrant) => entrant.route === "direct" || entrant.status === "advanced").map((entrant) => entrant.entryId)
    : !run && data.approvedCandidateCount === data.entrantCapacity
      ? data.approvedCandidates.map((candidate) => candidate.id)
      : [];
  const currentRoundFinished = run !== null && run.matchCount > 0 && run.finishedMatchCount === run.matchCount;
  const canGenerate = Boolean(run && !run.completedAt && (run.matchCount === 0 || currentRoundFinished));

  function moveToRank(entryId: string, nextRank: number) {
    const currentRank = order.indexOf(entryId) + 1;
    if (!currentRank || !nextRank || currentRank === nextRank) return;
    const next = [...order];
    [next[currentRank - 1], next[nextRank - 1]] = [next[nextRank - 1]!, next[currentRank - 1]!];
    setOrder(next);
    if (run) {
      startTransition(() => void reportResult(
        () => saveCompetitionQualificationRank({ seasonId: data.seasonId, entryId, nextRank }),
        "Play-in 预排名已保存",
      ));
    }
  }

  return (
    <div className="space-y-5">
      <Panel label="MAIN EVENT · 正赛规模">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px] md:items-end">
          <div>
            <Marker sub={`${data.approvedCandidateCount} 支已批准队伍 · 容量 ${data.entrantCapacity}`}>Major {data.managedProfileId === "major-24" ? "24" : "32"}</Marker>
            <p className="mt-2 text-sm text-[var(--color-fg-mid)]">资格赛单独管理，晋级结果会在赛前准备中确认正赛参赛名单。</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="major-managed-profile">正赛规模</Label>
            <Select
              value={data.managedProfileId}
              disabled={pending || data.seasonStatus !== "registration" || data.entrantsLocked || Boolean(run) || data.entrants.length > 0}
              onValueChange={(value) => startTransition(() => void reportResult(
                () => setMajorManagedProfile({ seasonId: data.seasonId, profileId: value as "major-24" | "major-32" }),
                "Major 正赛规模已更新",
              ))}
            >
              <SelectTrigger id="major-managed-profile"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="major-24">Major 24</SelectItem>
                <SelectItem value="major-32">Major 32</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
          <p className="text-sm text-[var(--color-fg-mid)]">
            {run?.completedAt ? "正赛集合由直通队与 Play-in 晋级队组成。" : data.approvedCandidateCount === data.entrantCapacity ? "当前已批准报名恰好达到正赛容量，将全部同步。" : "达到正赛容量或完成 Play-in 后，系统才会确定完整正赛集合。"}
          </p>
          <Button
            disabled={pending || data.entrantsLocked || finalEntryIds.length !== data.entrantCapacity || data.approvedCandidates.length !== data.approvedCandidateCount}
            onClick={() => startTransition(() => void reportResult(
              () => selectMajorEntrants({ seasonId: data.seasonId, competitionEntryIds: finalEntryIds }),
              "正赛参赛队已确认，已批准名单同步完成",
            ))}
          >确认并同步 {data.entrantCapacity} 支正赛队</Button>
        </div>
      </Panel>

      <Panel label="PLAY-IN · 资格赛">
        {!run ? (
          <div className="space-y-4">
            {data.approvedCandidateCount <= data.entrantCapacity ? (
              <p className="text-sm text-[var(--color-fg-mid)]">
                {data.approvedCandidateCount === data.entrantCapacity
                  ? "已批准报名恰好达到正赛容量；确认时全部队伍将自动成为正赛参赛队。"
                  : `已批准报名尚未达到正赛容量 ${data.entrantCapacity} 支，当前不能确认或配置 Play-in。`}
              </p>
            ) : plan ? (
              <>
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <p>直通正赛 <strong>{plan.directEntryCount}</strong> 队</p>
                  <p>参加 Play-in <strong>{plan.playInEntryCount}</strong> 队</p>
                  <p>晋级正赛 <strong>{plan.qualifierCount}</strong> 队</p>
                </div>
                <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)] md:items-end">
                  <div className="space-y-2">
                    <Label htmlFor="qualification-format">资格赛赛制</Label>
                    <Select value={format} onValueChange={(value) => setFormat(value as CompetitionQualificationFormat)}>
                      <SelectTrigger id="qualification-format"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="direct_bo3">Direct BO3</SelectItem>
                        <SelectItem value="short_swiss_2w2l" disabled={!shortSwissAllowed}>Short Swiss BO1 · 2 胜晋级 / 2 负淘汰</SelectItem>
                      </SelectContent>
                    </Select>
                    {!shortSwissAllowed && <p className="text-xs text-[var(--color-fg-dim)]">{SHORT_SWISS_DISABLED_NOTE}</p>}
                  </div>
                  <p className="text-sm text-[var(--color-fg-mid)]">
                    报名截止并完成所有待审后，确认会锁定全部 {data.approvedCandidateCount} 支已批准队伍。正赛切线与队数由系统计算。
                  </p>
                </div>
                <div className="overflow-x-auto border border-[var(--color-border)]">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead className="bg-[var(--color-panel-low)] text-xs text-[var(--color-fg-mid)]"><tr><th className="px-3 py-2">预排名</th><th className="px-3 py-2">队伍</th><th className="px-3 py-2">系统参考</th></tr></thead>
                    <tbody>{order.map((entryId, index) => {
                      const candidate = candidatesById.get(entryId);
                      if (!candidate) return null;
                      const strength = data.strengthPreview.teams.find((team) => team.teamId === entryId);
                      return <tr key={entryId} className="border-t border-[var(--color-border)]">
                        <td className="px-3 py-2 tabular-nums"><Select value={String(index + 1)} onValueChange={(value) => moveToRank(entryId, Number(value))}>
                          <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                          <SelectContent>{order.map((_, rank) => <SelectItem key={rank + 1} value={String(rank + 1)}>{rank + 1}</SelectItem>)}</SelectContent>
                        </Select></td>
                        <td className="px-3 py-2">{candidate.name}</td>
                        <td className="px-3 py-2">{strength?.recommendationRank === null || !strength ? "—" : `#${strength.recommendationRank}`}</td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
                {data.pendingReviewCount > 0 && <p className="text-sm text-[var(--color-warn)]">仍有 {data.pendingReviewCount} 支报名处于待审、补正或候补状态。</p>}
                {data.approvedCandidates.length !== data.approvedCandidateCount && <p className="text-sm text-[var(--color-warn)]">部分已批准报名缺少有效审核名单，需先修复报名资料。</p>}
                <div className="flex justify-end">
                  <Button disabled={pending || !canConfigure || (format === "short_swiss_2w2l" && !shortSwissAllowed)} onClick={() => startTransition(() => void reportResult(
                    () => configureCompetitionQualification({ seasonId: data.seasonId, format, preliminaryOrderEntryIds: order }),
                    "Play-in 候选队伍与预排名已锁定",
                  ))}>确认 Play-in 配置</Button>
                </div>
              </>
            ) : <p className="text-sm text-[var(--color-warn)]">当前报名规模无法通过单层 Play-in 收敛到目标正赛规模。</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Marker sub={run.completedAt ? "资格赛已完成" : run.startedAt ? "进行中" : "已配置，等待首轮"}>
                  {run.format === "direct_bo3" ? "Direct BO3" : "Short Swiss BO1 · 2W/2L"}
                </Marker>
                <p className="mt-2 text-sm text-[var(--color-fg-mid)]">直通 {run.directEntryCount} · Play-in {run.playInEntryCount} · 晋级名额 {run.qualifierCount} · 正赛容量 {run.targetEntrantCount}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!run.startedAt && run.matchCount === 0 && <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirmReset(true)}>重置配置</Button>}
                {canGenerate && <Button size="sm" disabled={pending} onClick={() => startTransition(async () => {
                  const result = await generateCompetitionQualificationRound({ seasonId: data.seasonId, runId: run.id });
                  if (!result.success) toast.error(result.error.message);
                  else toast.success(result.data.created ? `第 ${result.data.round} 轮对阵已生成` : `第 ${result.data.round} 轮已存在`);
                })}>{run.matchCount === 0 ? "生成首轮 Play-in 比赛" : `生成第 ${run.currentRound + 1} 轮`}</Button>}
              </div>
            </div>
            {confirmReset && <InlineConfirm
              danger
              title="重置尚未开始的 Play-in 配置？"
              sub="候选预排名和赛制配置会被删除；已生成比赛或已开始的 run 无法重置。"
              confirmLabel="确认重置"
              onCancel={() => setConfirmReset(false)}
              onConfirm={() => {
                setConfirmReset(false);
                startTransition(() => void reportResult(
                  () => resetCompetitionQualification({ seasonId: data.seasonId }),
                  "Play-in 配置已重置",
                ));
              }}
            />}
            <p className="text-sm text-[var(--color-fg-mid)]">已生成 {run.matchCount} 场 · 已完成 {run.finishedMatchCount} 场{run.currentRound > 0 ? ` · 当前第 ${run.currentRound} 轮` : ""}</p>
            <div className="overflow-x-auto border border-[var(--color-border)]">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="bg-[var(--color-panel-low)] text-xs text-[var(--color-fg-mid)]"><tr><th className="px-3 py-2">预排名</th><th className="px-3 py-2">队伍</th><th className="px-3 py-2">路线</th><th className="px-3 py-2">战绩</th><th className="px-3 py-2">状态</th></tr></thead>
                <tbody>{run.entrants.map((entrant) => <tr key={entrant.entryId} className="border-t border-[var(--color-border)]">
                  <td className="px-3 py-2 tabular-nums">
                    {run.startedAt ? entrant.preliminarySeed : <Select value={String(entrant.preliminarySeed)} onValueChange={(value) => moveToRank(entrant.entryId, Number(value))}>
                      <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
                      <SelectContent>{run.entrants.map((row) => <SelectItem key={row.entryId} value={String(row.preliminarySeed)}>{row.preliminarySeed}</SelectItem>)}</SelectContent>
                    </Select>}
                  </td>
                  <td className="px-3 py-2">{entrant.teamName}</td>
                  <td className="px-3 py-2">{entrant.route === "direct" ? "直通正赛" : "Play-in"}</td>
                  <td className="px-3 py-2 tabular-nums">{entrant.wins}-{entrant.losses}</td>
                  <td className="px-3 py-2">{entrant.status === "advanced" ? entrant.route === "direct" ? "直通正赛" : "Play-in 晋级" : entrant.status === "eliminated" ? "淘汰" : entrant.status === "not_started" ? "待开始" : "进行中"}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <Link className="text-sm text-[var(--color-accent)] underline" href={`/${data.seasonSlug}/matches?stage=play-in`}>查看公开 Play-in 赛程</Link>
          </div>
        )}
      </Panel>
    </div>
  );
}
