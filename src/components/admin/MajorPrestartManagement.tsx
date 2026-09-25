"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  lockMajorPrestartEntrants,
} from "@/actions/major-prestart";
import { Button } from "@/components/ui/button";
import { Marker, Panel } from "@/components/rivalhub";
import { MajorStrengthStarterSummary, sourceLabel } from "@/components/admin/MajorStrengthStarterSummary";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import type { MajorPrestartPageData, MajorPrestartStrengthPreview } from "@/lib/admin/season-workspace/types";
import { formatCSTDate } from "@/lib/utils/date";
import type { ActionResult } from "@/types/action";

export type MajorPrestartManagementData = MajorPrestartPageData["management"];

async function showResult(work: () => Promise<ActionResult<void>>, success: string): Promise<void> {
  const result = await work();
  if (!result.success) toast.error(result.error.message);
  else toast.success(success);
}

function formatDate(value: string | null): string {
  return value ? formatCSTDate(value) : "未记录";
}

function rosterSummary(roster: { memberCount: number; primaryStarterCount: number }): string {
  return `${roster.memberCount} 人 · ${roster.primaryStarterCount} 名主力`;
}

function rosterStatusLabel(status: MajorPrestartManagementData["entrants"][number]["rosterStatus"]): string {
  if (status === "frozen") return "名单已冻结";
  if (status === "confirmed") return "名单已确认";
  return "等待名单确认";
}

function StrengthPreview({ preview }: { preview: MajorPrestartStrengthPreview }) {
  return (
    <section className="mt-6 border-t border-[var(--color-border)] pt-5" aria-labelledby="major-live-strength-preview">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="major-live-strength-preview" className="font-medium text-[var(--color-fg)]">实时队伍实力参考</h3>
          <p className="mt-1 text-xs text-[var(--color-fg-mid)]">
            候选期只读辅助参考 · 使用已批准名单中的 5 名预定主力 · 当前{sourceLabel(preview.platform)}资料
          </p>
        </div>
        <span className="text-xs text-[var(--color-fg-mid)]">不自动选择正式参赛队，不改变资格结论</span>
      </div>
      {preview.status !== "ready" && <div className="mt-3 border border-[var(--color-warn)] px-3 py-2 text-sm text-[var(--color-warn)]">
        {preview.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}
      </div>}
      {preview.status === "ready" && (preview.teams.length === 0 ? <p className="mt-3 text-sm text-[var(--color-fg-mid)]">当前没有可比较的已批准候选队伍。</p> : <div className="mt-3 overflow-x-auto border border-[var(--color-border)]">
        <table className="min-w-[820px] w-full text-left text-xs">
          <thead className="bg-[var(--color-panel-low)] text-[var(--color-fg-mid)]">
            <tr>
              <th className="px-3 py-2">系统参考</th>
              <th className="px-3 py-2">5 名预定主力与证据</th>
              <th className="px-3 py-2">资料状态</th>
            </tr>
          </thead>
          <tbody>
            {preview.teams.map((team) => (
              <tr key={team.teamId} className="border-t border-[var(--color-border)] align-top">
                <td className="w-44 px-3 py-3">
                  <p className="font-medium text-[var(--color-fg)]">
                    {team.recommendationRank === null ? "—" : `#${team.recommendationRank}`} · {team.teamName}
                  </p>
                  <p className="mt-1 text-[var(--color-fg-mid)]">
                    {team.tieState === "not_ranked" ? "未进入参考排序" : team.tieState === "tied" ? "系统并列" : "系统参考顺序"}
                  </p>
                </td>
                <td className="px-3 py-3">
                  {team.starters.length > 0 ? <div className="grid gap-2 md:grid-cols-5">
                    {team.starters.map((starter) => <MajorStrengthStarterSummary key={starter.userId} starter={starter} platform={preview.platform} showProvenance />)}
                  </div> : <span className="text-[var(--color-fg-mid)]">主力资料暂不可用</span>}
                </td>
                <td className="w-72 px-3 py-3">
                  {team.available ? <span className="text-[var(--color-ok)]">可计算 · 仅供辅助比较</span> : <div className="text-[var(--color-warn)]">
                    <p>无法计算，不按 0 参与排序</p>
                    <ul className="mt-1 list-disc pl-4">{team.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                  </div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>)}
    </section>
  );
}

function ApprovedCandidate({
  candidate,
}: {
  candidate: MajorPrestartManagementData["approvedCandidates"][number];
}) {
  return (
    <article className="border border-[var(--color-border)] p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center justify-between gap-2 font-medium text-[var(--color-fg)]">
            <span>{candidate.name}</span>
            <span className="text-xs text-[var(--color-ok)]">{candidate.selectedAsEntrant ? "已选择为正式参赛队" : "报名已通过 · 候选"}</span>
          </span>
          <span className="mt-1 block text-xs text-[var(--color-fg-mid)]">
            代表：{candidate.representativeName} · 提交：{formatDate(candidate.submittedAt)} · 审核：{formatDate(candidate.reviewedAt)} · 批准：{formatDate(candidate.approvedAt)}
          </span>
          <span className="mt-1 block text-xs text-[var(--color-fg-mid)]">
            已审核报名名单：{rosterSummary(candidate.roster)}
          </span>
        </div>
      </div>
      <ul className="mt-2 space-y-1 pl-7 text-xs text-[var(--color-fg-mid)]">
        {candidate.roster.members.length > 0 ? candidate.roster.members.map((member) => (
          <li key={member.userId}>
            <PlayerProfileLink userId={member.userId}>{member.label}</PlayerProfileLink>{member.isPrimaryStarter ? " · 主力" : ""}
          </li>
        )) : <li>名单成员缺失</li>}
      </ul>
    </article>
  );
}

function SyncedEntrant({ entrant }: { entrant: MajorPrestartManagementData["entrants"][number] }) {
  return (
    <article className="border border-[var(--color-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-[var(--color-fg)]">{entrant.teamName}</h3>
        <span className={`text-xs ${entrant.rosterStatus === "frozen" || entrant.rosterStatus === "confirmed" ? "text-[var(--color-ok)]" : "text-[var(--color-warn)]"}`}>
          {rosterStatusLabel(entrant.rosterStatus)}
        </span>
      </div>
      <ul className="mt-2 grid gap-1 text-sm text-[var(--color-fg-mid)]">
        {entrant.roster.map((member) => (
          <li key={member.userId}>
            <PlayerProfileLink userId={member.userId}>{member.label}</PlayerProfileLink>{member.isPrimaryStarter ? " · 主力" : ""} · {member.educationVerified ? "学籍资料已确认" : "学籍资料待补全"}
          </li>
        ))}
      </ul>
    </article>
  );
}

export function MajorPrestartManagement({ data }: { data: MajorPrestartManagementData }) {
  const [isPending, startTransition] = useTransition();
  const locked = data.entrantsLocked;
  const entrantCapacity = data.entrantCapacity;

  const candidatePanel = (
    <Panel label="已批准报名候选队伍">
      <div className="mb-4 space-y-2 text-sm text-[var(--color-fg-mid)]">
        <p>候选池用于核对报名资料与系统实力参考。正赛参赛队由全部已批准队伍或 Play-in 晋级结果确定，本页不提供手动替换。</p>
      </div>
      {data.approvedCandidates.length === 0 ? <p className="text-sm text-[var(--color-fg-mid)]">尚无已通过审核的报名队伍；完成报名审核后，队伍会自动出现在候选池。</p> : <div className="grid gap-3 md:grid-cols-2">
        {data.approvedCandidates.map((candidate) => <ApprovedCandidate key={candidate.id} candidate={candidate} />)}
      </div>}
      {!locked && <StrengthPreview preview={data.strengthPreview} />}
    </Panel>
  );

  return (
    <div className="space-y-6">
      <Panel label="赛前准备生命周期">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Marker sub={locked ? "正式参赛队与名单已冻结" : "从已通过的报名中选择并确认正式名单"}>
              {locked ? "已锁定正式参赛队" : "选择正式参赛队"}
            </Marker>
            <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
              {locked ? "锁定后，本页不能再修改正式参赛队、名单或事项；下一步是独立保存并确认种子。" : "报名通过后才会进入候选池；保存选择会同步已审核的报名名单，确认无误后再统一冻结达到赛事容量的队伍。"}
            </p>
          </div>
          {!locked && <Button disabled={isPending || data.entrants.length !== entrantCapacity} onClick={() => startTransition(() => void showResult(
            () => lockMajorPrestartEntrants({ seasonId: data.seasonId }), "正式参赛队和名单已统一冻结",
          ))}>统一冻结正式名单</Button>}
        </div>
      </Panel>

      {(locked || data.entrants.length > 0) && <Panel label={`正式参赛名单 (${data.entrants.length}/${entrantCapacity})`}>
        <p className="mb-4 text-sm text-[var(--color-fg-mid)]">下方展示当前正式参赛队的名单、主力标记和学籍资料状态；如需变更名单，应由队长和成员在报名页面完成修改并重新审核。</p>
        {data.entrants.length === 0 ? <p className="text-sm text-[var(--color-fg-mid)]">尚未保存最终选择。</p> : <div className="grid gap-3 md:grid-cols-2">
          {data.entrants.map((entrant) => <SyncedEntrant key={entrant.id} entrant={entrant} />)}
        </div>}
      </Panel>}

      {candidatePanel}

    </div>
  );
}
