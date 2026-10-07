"use client";

import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  configureCompetitionQualification,
  generateCompetitionQualificationRound,
  previewCompetitionQualificationRound,
  resetCompetitionQualification,
  saveCompetitionQualificationDraft,
} from "@/actions/competition-qualification";
import { selectMajorEntrants, setMajorManagedProfile } from "@/actions/major-prestart";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InlineConfirm, Marker, Panel } from "@/components/rivalhub";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HelpTooltip } from "@/components/rivalhub/HelpTooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deriveCompetitionQualificationPlan, isShortSwissQualificationAllowed, type CompetitionQualificationFormat } from "@/lib/competition-qualification/policy";
import type { MajorPrestartPageData } from "@/lib/admin/season-workspace/types";
import type { ActionResult } from "@/types/action";
import { MajorRankingWorkspace } from "./MajorRankingWorkspace";
import { formatCST } from "@/lib/utils/date";
import { initialPreliminaryOrder } from "@/lib/admin/season-workspace/ranking-order";

type ManagementData = MajorPrestartPageData["management"];
type QualificationRoundPreview = {
  round: number;
  format: "bo1" | "bo3";
  matchups: Array<{
    higherSeedTeamId: string;
    higherSeedTeamName: string;
    higherSeed: number;
    lowerSeedTeamId: string;
    lowerSeedTeamName: string;
    lowerSeed: number;
  }>;
};

async function reportResult(work: () => Promise<ActionResult<void>>, success: string): Promise<void> {
  const result = await work();
  if (result.success) toast.success(success);
  else toast.error(result.error.message);
}

export function MajorCompetitionFlow({ data, phase }: { data: ManagementData; phase: "plan" | "runtime" | "entrants" }) {
  const [pending, startTransition] = useTransition();
  const [savedDraft, setSavedDraft] = useState(data.qualification.draft);
  const [format, setFormat] = useState<CompetitionQualificationFormat>(data.qualification.draft?.format ?? "direct_bo3");
  const run = data.qualification.run;
  const persistedOrder = run ? initialPreliminaryOrder([], run.entrants) : [];
  const [order, setOrder] = useState(initialPreliminaryOrder(data.qualification.draft && !data.qualification.draft.stale ? data.qualification.draft.order : data.initialPreliminaryOrderEntryIds, run?.entrants ?? null));
  const [confirmReset, setConfirmReset] = useState(false);
  const [configPreviewOpen, setConfigPreviewOpen] = useState(false);
  const [roundPreview, setRoundPreview] = useState<QualificationRoundPreview | null>(null);
  const candidatesById = useMemo(() => new Map(data.approvedCandidates.map((candidate) => [candidate.id, candidate])), [data.approvedCandidates]);

  const plan = useMemo(() => {
    try {
      return deriveCompetitionQualificationPlan(data.approvedCandidateCount, data.entrantCapacity);
    } catch {
      return null;
    }
  }, [data.approvedCandidateCount, data.entrantCapacity]);
  const shortSwissAllowed = Boolean(plan && isShortSwissQualificationAllowed(plan.playInEntryCount));
  const draftStale = savedDraft?.stale === true || (savedDraft && (savedDraft.targetEntrantCount !== data.entrantCapacity || savedDraft.order.length !== data.approvedCandidateCount || data.approvedCandidates.some(candidate => !savedDraft.order.includes(candidate.id))));
  const dirty = !savedDraft || format !== savedDraft.format || order.length !== savedDraft.order.length || order.some((id, index) => id !== savedDraft.order[index]);
  const canConfigure = !dirty && !draftStale && Boolean(savedDraft) && data.seasonStatus === "registration" && data.registrationClosed && !data.qualification.run &&
    data.pendingReviewCount === 0 && plan !== null && data.approvedCandidates.length === data.approvedCandidateCount &&
    order.length === data.approvedCandidateCount;
  const finalEntryIds = run?.completedAt
    ? run.entrants.filter((entrant) => entrant.route === "direct" || entrant.status === "advanced").map((entrant) => entrant.entryId)
    : !run && data.approvedCandidateCount === data.entrantCapacity
      ? data.approvedCandidates.map((candidate) => candidate.id)
      : [];
  const currentRoundFinished = run !== null && run.matchCount > 0 && run.finishedMatchCount === run.matchCount;
  const canGenerate = Boolean(run && !run.completedAt && (run.matchCount === 0 || currentRoundFinished));
  const rosterByEntryId = new Map(data.rankingRoster.map((row) => [row.entryId, row.members]));
  const strengthByEntryId = new Map(data.strengthPreview.teams.map((team) => [team.teamId, team]));
  const rankingTeams = (run?.entrants.map((entrant) => ({ id: entrant.entryId, name: entrant.teamName, route: entrant.route, status: entrant.status, wins: entrant.wins, losses: entrant.losses }))
    ?? data.approvedCandidates.map((candidate) => ({ id: candidate.id, name: candidate.name, route: "play-in" as const, status: "not_started" as const, wins: 0, losses: 0 })))
    .map((entry) => ({
      entryId: entry.id,
      teamName: entry.name,
      systemRank: strengthByEntryId.get(entry.id)?.recommendationRank ?? null,
      tieState: strengthByEntryId.get(entry.id)?.tieState,
      members: rosterByEntryId.get(entry.id) ?? [],
      route: entry.route === "direct" ? "直通正赛" : entry.status === "advanced" ? `Play-in 晋级 · ${entry.wins}-${entry.losses}` : entry.status === "eliminated" ? `Play-in 淘汰 · ${entry.wins}-${entry.losses}` : run?.startedAt ? `Play-in · ${entry.wins}-${entry.losses}` : "Play-in",
      result: entry.route === "play-in" && run?.startedAt ? `${entry.wins}-${entry.losses}` : undefined,
    }));
  const cut = run?.directEntryCount ?? plan?.directEntryCount;

  function previewNextRound() {
    if (!run) return;
    startTransition(async () => {
      const result = await previewCompetitionQualificationRound({ seasonId: data.seasonId, runId: run.id });
      if (!result.success) toast.error(result.error.message);
      else setRoundPreview(result.data);
    });
  }

  function saveDraft() {
    startTransition(async () => {
      const result = await saveCompetitionQualificationDraft({ seasonId: data.seasonId, format, order, expectedVersion: savedDraft?.version ?? null });
      if (!result.success) toast.error(result.error.message);
      else { setSavedDraft(result.data); toast.success("预排名草稿已保存"); }
    });
  }

  function confirmConfiguration() {
    if (!canConfigure || !savedDraft) return;
    startTransition(async () => {
      const result = await configureCompetitionQualification({
        seasonId: data.seasonId,
        format,
        preliminaryOrderEntryIds: order,
        expectedDraftVersion: savedDraft!.version,
      });
      if (!result.success) toast.error(result.error.message);
      else {
        toast.success("Play-in 候选队伍与预排名已锁定");
        setConfigPreviewOpen(false);
      }
    });
  }

  function confirmRoundGeneration() {
    if (!run || !roundPreview) return;
    const preview = roundPreview;
    startTransition(async () => {
      const result = await generateCompetitionQualificationRound({
        seasonId: data.seasonId,
        runId: run.id,
        expectedPairings: preview.matchups.map(({ higherSeedTeamId, lowerSeedTeamId }) => ({ higherSeedTeamId, lowerSeedTeamId })),
      });
      if (!result.success) toast.error(result.error.message);
      else {
        toast.success(result.data.created ? `第 ${result.data.round} 轮对阵已生成` : `第 ${result.data.round} 轮已存在`);
        setRoundPreview(null);
      }
    });
  }

  return (
    <div className="space-y-5">
      {(phase === "plan" || phase === "entrants") && <Panel label="正赛规模 · MAIN EVENT">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px] md:items-end">
          <div>
            <Marker sub={`${data.approvedCandidateCount} 支已批准 · ${data.entrantCapacity} 个正赛名额`}>Major {data.managedProfileId === "major-24" ? "24" : "32"}</Marker>
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
          <p className="text-sm text-[var(--color-fg-mid)]">{data.entrants.length === data.entrantCapacity ? "正赛参赛队已确认" : `正赛候选 ${finalEntryIds.length}/${data.entrantCapacity}`}</p>
          {data.entrants.length !== data.entrantCapacity && <Button
            disabled={pending || data.entrantsLocked || finalEntryIds.length !== data.entrantCapacity || data.approvedCandidates.length !== data.approvedCandidateCount}
            onClick={() => startTransition(() => void reportResult(
              () => selectMajorEntrants({ seasonId: data.seasonId, competitionEntryIds: finalEntryIds }),
              "正赛参赛队已确认，已批准名单同步完成",
            ))}
          >确认并同步 {data.entrantCapacity} 支正赛队</Button>}
        </div>
      </Panel>}

      {phase !== "entrants" && <Panel label="资格赛 · PLAY-IN">
        {!run ? (
          <div className="space-y-4">
            {data.approvedCandidateCount <= data.entrantCapacity ? (
              <p className="text-sm text-[var(--color-fg-mid)]">已批准 {data.approvedCandidateCount}/{data.entrantCapacity}</p>
            ) : plan ? (
              <>
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <p>直通正赛 <strong>{plan.directEntryCount}</strong> 队</p>
                  <p>参加 Play-in <strong>{plan.playInEntryCount}</strong> 队</p>
                  <p>晋级正赛 <strong>{plan.qualifierCount}</strong> 队</p>
                </div>
                <div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5"><Label htmlFor="qualification-format">赛制</Label><HelpTooltip label="赛制说明" content="Short Swiss 为 BO1，2 胜晋级、2 负淘汰；Play-in 队数须为 4 的倍数。" /></div>
                    <Select value={format} onValueChange={(value) => setFormat(value as CompetitionQualificationFormat)}>
                      <SelectTrigger id="qualification-format"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="direct_bo3">Direct BO3</SelectItem>
                        <SelectItem value="short_swiss_2w2l" disabled={!shortSwissAllowed}>Short Swiss BO1 · 2 胜晋级 / 2 负淘汰</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <MajorRankingWorkspace mode="preliminary" teams={rankingTeams} order={order} onOrderChange={setOrder} platform={data.strengthPreview.platform} boundaryAfter={plan.directEntryCount} boundaryLabel="直通正赛 / Play-in" />
                {data.pendingReviewCount > 0 && <p className="text-sm text-[var(--color-warn)]">仍有 {data.pendingReviewCount} 支报名处于待审、补正或候补状态。</p>}
                {data.approvedCandidates.length !== data.approvedCandidateCount && <p className="text-sm text-[var(--color-warn)]">部分已批准报名缺少有效审核名单，需先修复报名资料。</p>}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p role="status" className="text-xs text-[var(--color-fg-mid)]">{savedDraft ? `草稿 v${savedDraft.version} · ${formatCST(savedDraft.updatedAt)} · ${savedDraft.updatedBy}` : "尚未保存草稿"} · {draftStale ? "候选集合已变化，请重新编辑并保存" : dirty ? "有未保存修改" : "已保存"}</p>
                  <Button disabled={pending || (!dirty && !draftStale)} onClick={saveDraft}>保存草稿</Button>
                  <Button disabled={pending || !canConfigure || (format === "short_swiss_2w2l" && !shortSwissAllowed)} onClick={() => setConfigPreviewOpen(true)}>预览 Play-in 配置</Button>
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
                {canGenerate && <Button size="sm" disabled={pending} onClick={previewNextRound}>{run.matchCount === 0 ? "预览首轮对阵" : `预览第 ${run.currentRound + 1} 轮`}</Button>}
              </div>
            </div>
            {confirmReset && <InlineConfirm
              danger
              title="重置尚未开始的 Play-in 配置？"
              sub="返回可编辑的已保存草稿；已生成比赛或已开始的配置无法重置。"
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
            {run.startedAt ? <details className="border border-[var(--color-border)] p-3">
              <summary className="cursor-pointer text-sm">查看已冻结的预排名与队伍证据</summary>
              <div className="mt-3"><MajorRankingWorkspace mode="preliminary" teams={rankingTeams} order={persistedOrder} platform={data.strengthPreview.platform} boundaryAfter={cut} boundaryLabel="直通正赛 / Play-in" /></div>
            </details> : <MajorRankingWorkspace mode="preliminary" teams={rankingTeams} order={persistedOrder} platform={data.strengthPreview.platform} boundaryAfter={cut} boundaryLabel="直通正赛 / Play-in" />}
            <Link className="text-sm text-[var(--color-accent)] underline" href={`/admin/${data.seasonSlug}/matches?stage=play-in`}>进入比赛管理</Link>
          </div>
        )}
      </Panel>}
      <Dialog open={configPreviewOpen} onOpenChange={setConfigPreviewOpen}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle>Play-in 配置预览</DialogTitle>
            <DialogDescription>确认后会锁定候选名单、赛制和预排名。</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <p>正赛容量 <strong>{plan?.targetEntrantCount ?? data.entrantCapacity}</strong></p>
              <p>已批准候选 <strong>{order.length}</strong></p>
              <p>赛制 <strong>{format === "direct_bo3" ? "Direct BO3" : "Short Swiss BO1 · 2W/2L"}</strong></p>
              <p>晋级名额 <strong>{plan?.qualifierCount ?? 0}</strong></p>
              <p>直通正赛 <strong>{plan?.directEntryCount ?? 0}</strong></p>
              <p>参加 Play-in <strong>{plan?.playInEntryCount ?? 0}</strong></p>
              <p>切线 <strong>前 {plan?.directEntryCount ?? 0} 队直通</strong></p>
            </div>
            <div className="max-h-[min(55dvh,34rem)] overflow-auto border border-[var(--color-border)]">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="sticky top-0 bg-[var(--color-panel-low)] text-xs text-[var(--color-fg-mid)]"><tr><th className="px-3 py-2">预排名</th><th className="px-3 py-2">队伍</th><th className="px-3 py-2">路径</th><th className="px-3 py-2">参考位次</th></tr></thead>
                <tbody>{order.map((entryId, index) => {
                  const candidate = candidatesById.get(entryId);
                  if (!candidate) return null;
                  const strength = data.strengthPreview.teams.find((team) => team.teamId === entryId);
                  const direct = index < (plan?.directEntryCount ?? 0);
                  return <tr key={entryId} className={`border-t border-[var(--color-border)] ${index === (plan?.directEntryCount ?? 0) ? "border-t-2 border-t-[var(--color-accent)]" : ""}`}>
                    <td className="px-3 py-2 tabular-nums">P{index + 1}</td>
                    <td className="px-3 py-2"><TeamProfileLink entryId={entryId} seasonSlug={data.seasonSlug}>{candidate.name}</TeamProfileLink></td>
                    <td className="px-3 py-2">{direct ? "直通正赛" : "Play-in"}</td>
                    <td className="px-3 py-2">{strength?.recommendationRank === null || !strength ? "—" : `#${strength.recommendationRank}`}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setConfigPreviewOpen(false)}>返回调整</Button>
            <Button disabled={pending || !canConfigure || (format === "short_swiss_2w2l" && !shortSwissAllowed)} onClick={confirmConfiguration}>确认并锁定配置</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(roundPreview)} onOpenChange={(open) => { if (!open) setRoundPreview(null); }}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{roundPreview ? `第 ${roundPreview.round} 轮对阵预览` : "Play-in 对阵预览"}</DialogTitle>
            <DialogDescription>{roundPreview?.format === "bo3" ? "Direct BO3" : "Short Swiss BO1"} · 确认后开始本轮比赛</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <ol className="space-y-2">
              {roundPreview?.matchups.map((matchup, index) => <li key={`${matchup.higherSeedTeamId}:${matchup.lowerSeedTeamId}`} className="flex items-center gap-3 border-b border-[var(--color-border)] py-2 text-sm">
                <span className="w-8 text-[var(--color-fg-dim)]">{index + 1}.</span>
                <span className="min-w-0 flex-1 text-right"><strong>P{matchup.higherSeed}</strong> {matchup.higherSeedTeamName}</span>
                <span className="text-[var(--color-fg-dim)]">vs</span>
                <span className="min-w-0 flex-1"><strong>P{matchup.lowerSeed}</strong> {matchup.lowerSeedTeamName}</span>
              </li>)}
            </ol>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setRoundPreview(null)}>取消</Button>
            <Button disabled={pending || !roundPreview} onClick={confirmRoundGeneration}>确认并生成对阵</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
