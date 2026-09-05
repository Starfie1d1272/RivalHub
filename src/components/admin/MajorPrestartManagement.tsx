"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addMajorPrestartIssue,
  lockMajorPrestartEntrants,
  resolveMajorPrestartIssue,
  selectMajorEntrants,
} from "@/actions/major-prestart";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Marker, Panel } from "@/components/rivalhub";
import type { ActionResult } from "@/types/action";

export interface MajorPrestartManagementData {
  seasonId: string;
  entrantCapacity: number;
  entrantsLocked: boolean;
  approvedCandidates: Array<{
    id: string;
    name: string;
    representativeName: string;
    submittedAt: string | null;
    reviewedAt: string | null;
    approvedAt: string | null;
    approvedRosterRevisionId: string;
    qualificationStatus: "approved";
    selectedAsEntrant: boolean;
    roster: {
      memberCount: number;
      primaryStarterCount: number;
      members: Array<{ userId: string; email: string; isPrimaryStarter: boolean }>;
    };
  }>;
  entrants: Array<{
    id: string;
    teamId: string;
    teamName: string;
    rosterStatus: "preparing" | "confirmed" | "frozen";
    sourceRosterRevisionId: string | null;
    roster: Array<{ userId: string; email: string; isPrimaryStarter: boolean; educationVerificationId: string | null }>;
  }>;
  issues: Array<{ id: string; category: "qualification" | "administration"; label: string; resolved: boolean }>;
}

async function showResult(work: () => Promise<ActionResult<void>>, success: string): Promise<void> {
  const result = await work();
  if (!result.success) toast.error(result.error.message);
  else toast.success(success);
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("zh-CN") : "未记录";
}

function rosterSummary(roster: { memberCount: number; primaryStarterCount: number }): string {
  return `${roster.memberCount} 人 · ${roster.primaryStarterCount} 名主力`;
}

function rosterStatusLabel(status: MajorPrestartManagementData["entrants"][number]["rosterStatus"]): string {
  if (status === "frozen") return "名单已冻结";
  if (status === "confirmed") return "已从 approved revision 同步";
  return "待同步";
}

function ApprovedCandidate({
  candidate,
  checked,
  disabled,
  onToggle,
}: {
  candidate: MajorPrestartManagementData["approvedCandidates"][number];
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 border border-[var(--color-border)] p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-accent)]">
      <Checkbox checked={checked} disabled={disabled} onChange={onToggle} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center justify-between gap-2 font-medium text-[var(--color-fg)]">
          <span>{candidate.name}</span>
          <span className="text-xs text-[var(--color-ok)]">{candidate.selectedAsEntrant ? "已选择为正式参赛队" : "Entry 已批准 · 候选"}</span>
        </span>
        <span className="mt-1 block text-xs text-[var(--color-fg-mid)]">
          代表：{candidate.representativeName} · 提交：{formatDate(candidate.submittedAt)} · 审核：{formatDate(candidate.reviewedAt)} · 批准：{formatDate(candidate.approvedAt)}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-fg-mid)]">
          approved roster：{rosterSummary(candidate.roster)} · revision：{candidate.approvedRosterRevisionId.slice(0, 8)}…
        </span>
        <span className="mt-2 block text-xs text-[var(--color-fg-mid)]">
          {candidate.roster.members.map((member) => `${member.email}${member.isPrimaryStarter ? "（主力）" : ""}`).join("、") || "名单成员缺失"}
        </span>
      </span>
    </label>
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
      <p className="mt-2 text-xs text-[var(--color-fg-mid)]">
        EventRoster 来源：{entrant.sourceRosterRevisionId ? `${entrant.sourceRosterRevisionId.slice(0, 8)}…` : "未同步"}
      </p>
      <ul className="mt-2 grid gap-1 text-sm text-[var(--color-fg-mid)]">
        {entrant.roster.map((member) => (
          <li key={member.userId}>
            {member.email}{member.isPrimaryStarter ? " · 主力" : ""} · {member.educationVerificationId ? "教育证据已绑定" : "教育证据缺失"}
          </li>
        ))}
      </ul>
    </article>
  );
}

export function MajorPrestartManagement({ data }: { data: MajorPrestartManagementData }) {
  const [isPending, startTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(data.entrants.map((entrant) => entrant.teamId)));
  const [issueLabel, setIssueLabel] = useState("");
  const [issueCategory, setIssueCategory] = useState<"qualification" | "administration">("qualification");
  const locked = data.entrantsLocked;
  const entrantCapacity = data.entrantCapacity;
  const selectedCount = selectedIds.size;
  const approvedCount = data.approvedCandidates.length;
  const requiresExactCapacity = approvedCount > entrantCapacity;

  useEffect(() => {
    setSelectedIds(new Set(data.entrants.map((entrant) => entrant.teamId)));
  }, [data.entrants]);

  const toggleSelection = (entryId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <Panel label="赛前准备生命周期">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Marker sub={locked ? "正式参赛队与 EventRoster 已冻结" : "从已批准 Entry 选择并同步正式名单"}>
              {locked ? "已锁定正式参赛队" : "选择正式参赛队"}
            </Marker>
            <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
              {locked ? "锁定后，本页不能再修改正式参赛队、EventRoster 或事项；下一步是独立保存并确认种子。" : "Entry approval 是候选资格；保存选择会从每个 Entry 的最新 approved roster revision 原子同步 EventRoster，最后统一冻结达到赛事容量的队伍。"}
            </p>
          </div>
          {!locked && <Button disabled={isPending} onClick={() => startTransition(() => void showResult(
            () => lockMajorPrestartEntrants({ seasonId: data.seasonId }), "正式参赛队和 EventRoster 已统一冻结",
          ))}>统一冻结正式名单</Button>}
        </div>
      </Panel>

      <Panel label={`最终参赛队选择 (${selectedCount}/${entrantCapacity})`}>
        <div className="mb-4 space-y-2 text-sm text-[var(--color-fg-mid)]">
          <p>候选池只展示当前赛事中已批准的 CompetitionEntry；资格审核、成员确认、主力与教育事实由 Entry owner 维护，本页不再逐队手工选择 5–9 人。</p>
          <p>{approvedCount <= entrantCapacity ? `当前 ${approvedCount} 支已批准队伍不超过容量，可一键选中全部。` : `当前 ${approvedCount} 支已批准队伍超过容量，请明确选择恰好 ${entrantCapacity} 支；选择依据由赛事运营者决定。`}</p>
        </div>
        {!locked && <div className="mb-4 flex flex-wrap gap-2">
          {approvedCount <= entrantCapacity && <Button size="sm" variant="outline" disabled={isPending || approvedCount === 0} onClick={() => setSelectedIds(new Set(data.approvedCandidates.map((candidate) => candidate.id)))}>
            一键选择全部已批准
          </Button>}
          <Button size="sm" disabled={isPending || (requiresExactCapacity && selectedCount !== entrantCapacity)} onClick={() => startTransition(() => void showResult(
            () => selectMajorEntrants({ seasonId: data.seasonId, competitionEntryIds: [...selectedIds] }), "正式参赛队已保存，EventRoster 已按 approved revision 同步",
          ))}>
            保存选择并同步 EventRoster
          </Button>
        </div>}
        {data.approvedCandidates.length === 0 ? <p className="text-sm text-[var(--color-fg-mid)]">尚无已批准的 CompetitionEntry；完成 Entry 审核后，队伍会自动出现在候选池。</p> : <div className="grid gap-3 md:grid-cols-2">
          {data.approvedCandidates.map((candidate) => <ApprovedCandidate key={candidate.id} candidate={candidate} checked={selectedIds.has(candidate.id)} disabled={locked || isPending} onToggle={() => toggleSelection(candidate.id)} />)}
        </div>}
      </Panel>

      <Panel label={`已 materialize 的正式名单 (${data.entrants.length}/${entrantCapacity})`}>
        <p className="mb-4 text-sm text-[var(--color-fg-mid)]">下方是当前最终选择对应的 Entry-owned EventRoster，只读展示同步来源、主力标记与教育证据；名单变更必须由队长和成员在 Entry roster-change 流程中完成并重新审核。</p>
        {data.entrants.length === 0 ? <p className="text-sm text-[var(--color-fg-mid)]">尚未保存最终选择。</p> : <div className="grid gap-3 md:grid-cols-2">
          {data.entrants.map((entrant) => <SyncedEntrant key={entrant.id} entrant={entrant} />)}
        </div>}
      </Panel>

      <Panel label="资格与管理事项">
        {!locked && <form className="mb-4 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); startTransition(() => void showResult(async () => {
          const result = await addMajorPrestartIssue({ seasonId: data.seasonId, category: issueCategory, label: issueLabel });
          if (result.success) setIssueLabel("");
          return result;
        }, "赛前事项已记录")); }}>
          <Select value={issueCategory} onValueChange={(value) => setIssueCategory(value as typeof issueCategory)}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="qualification">资格事项</SelectItem><SelectItem value="administration">管理事项</SelectItem></SelectContent></Select>
          <Input value={issueLabel} onChange={(event) => setIssueLabel(event.target.value)} placeholder="例如：资格材料复核" className="max-w-sm" />
          <Button type="submit" disabled={isPending || !issueLabel.trim()}>添加事项</Button>
        </form>}
        {data.issues.length === 0 ? <p className="text-sm text-[var(--color-fg-mid)]">尚未记录待处理事项。</p> : <ul className="space-y-2 text-sm">{data.issues.map((issue) => <li key={issue.id} className="flex flex-wrap items-center justify-between gap-2 border border-[var(--color-border)] px-3 py-2"><span>{issue.category === "qualification" ? "资格" : "管理"} · {issue.label} · <span className={issue.resolved ? "text-[var(--color-ok)]" : "text-[var(--color-warn)]"}>{issue.resolved ? "已处理" : "未处理"}</span></span>{!locked && !issue.resolved && <Button size="sm" variant="outline" disabled={isPending} onClick={() => startTransition(() => void showResult(() => resolveMajorPrestartIssue({ seasonId: data.seasonId, issueId: issue.id }), "事项已标记为已处理"))}>标记已处理</Button>}</li>)}</ul>}
      </Panel>
    </div>
  );
}
