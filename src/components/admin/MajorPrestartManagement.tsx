"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  addMajorPrestartEntrant,
  addMajorPrestartIssue,
  confirmMajorPrestartRoster,
  lockMajorPrestartEntrants,
  removeMajorPrestartEntrant,
  resolveMajorPrestartIssue,
  saveMajorPrestartRoster,
} from "@/actions/major-prestart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Marker, Panel } from "@/components/rivalhub";
import type { ActionResult } from "@/types/action";

export interface MajorPrestartManagementData {
  seasonId: string;
  entrantsLocked: boolean;
  availableTeams: Array<{ id: string; name: string; members: Array<{ userId: string; email: string }> }>;
  entrants: Array<{
    id: string;
    teamId: string;
    teamName: string;
    rosterConfirmedAt: Date | null;
    roster: Array<{ userId: string; email: string }>;
    candidates: Array<{ userId: string; email: string }>;
  }>;
  issues: Array<{ id: string; category: "qualification" | "administration"; label: string; resolved: boolean }>;
}

async function showResult(work: () => Promise<ActionResult<void>>, success: string): Promise<void> {
  const result = await work();
  if (!result.success) toast.error(result.error.message);
  else toast.success(success);
}

function EntrantRoster({ entrant, seasonId, locked }: {
  entrant: MajorPrestartManagementData["entrants"][number]; seasonId: string; locked: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const initial = useMemo(() => entrant.roster.map((member) => member.userId), [entrant.roster]);
  const [selected, setSelected] = useState(initial);
  const toggle = (userId: string) => setSelected((current) => current.includes(userId)
    ? current.filter((id) => id !== userId)
    : [...current, userId]);

  return (
    <article className="border border-[var(--color-border)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-[var(--color-fg)]">{entrant.teamName}</h3>
        <span className={`text-xs ${entrant.rosterConfirmedAt ? "text-emerald-700" : "text-amber-800"}`}>
          {entrant.rosterConfirmedAt ? "名单已确认" : "待确认名单"}
        </span>
      </div>
      <fieldset className="mt-2 grid gap-1 text-sm text-[var(--color-fg-mid)]" disabled={locked || isPending}>
        <legend className="sr-only">{entrant.teamName} 最终赛事名单</legend>
        {entrant.candidates.map((candidate) => <label key={candidate.userId} className="flex items-center gap-2">
          <Checkbox checked={selected.includes(candidate.userId)} onChange={() => toggle(candidate.userId)} />
          {candidate.email}
        </label>)}
      </fieldset>
      {!locked && <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={isPending} onClick={() => startTransition(() => void showResult(
          () => saveMajorPrestartRoster({ seasonId, entrantId: entrant.id, userIds: selected }), "最终名单已保存，需重新确认",
        ))}>保存最终名单</Button>
        <Button size="sm" disabled={isPending} onClick={() => startTransition(() => void showResult(
          () => confirmMajorPrestartRoster({ seasonId, entrantId: entrant.id }), "最终名单已确认",
        ))}>确认名单</Button>
      </div>}
    </article>
  );
}

export function MajorPrestartManagement({ data }: { data: MajorPrestartManagementData }) {
  const [isPending, startTransition] = useTransition();
  const [teamId, setTeamId] = useState(data.availableTeams[0]?.id ?? "");
  const [issueLabel, setIssueLabel] = useState("");
  const [issueCategory, setIssueCategory] = useState<"qualification" | "administration">("qualification");
  const locked = data.entrantsLocked;

  return <div className="space-y-6">
    <Panel label="赛前准备生命周期">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><Marker sub={locked ? "正式参赛队与最终名单已锁定" : "可调整正式参赛队与最终名单"}>
          {locked ? "已锁定正式参赛队" : "准备正式参赛队"}
        </Marker><p className="mt-1 text-sm text-[var(--color-fg-mid)]">锁定后，本页不能再修改正式参赛队、最终赛事名单或事项；下一步是独立保存并确认 1–32 种子。</p></div>
        {!locked && <Button disabled={isPending} onClick={() => startTransition(() => void showResult(
          () => lockMajorPrestartEntrants({ seasonId: data.seasonId }), "正式参赛队和最终赛事名单已锁定",
        ))}>锁定正式参赛队</Button>}
      </div>
    </Panel>

    <Panel label={`正式参赛队 (${data.entrants.length}/32)`}>
      {!locked && <div className="mb-4 flex flex-wrap gap-2">
        <Select value={teamId} onValueChange={setTeamId}><SelectTrigger className="min-w-48"><SelectValue placeholder="选择已审核正式队伍" /></SelectTrigger><SelectContent>{data.availableTeams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}（{team.members.length} 人）</SelectItem>)}</SelectContent></Select>
        <Button disabled={isPending || !teamId} onClick={() => startTransition(() => void showResult(
          () => addMajorPrestartEntrant({ seasonId: data.seasonId, teamId }), "已加入正式参赛队集合",
        ))}>加入正式参赛队</Button>
      </div>}
      {data.entrants.length === 0 ? <p className="text-sm text-[var(--color-fg-mid)]">尚未选择正式参赛队。所有已审核 teams 不会自动成为 Major 参赛队。</p> : <div className="grid gap-3 md:grid-cols-2">
        {data.entrants.map((entrant) => <div key={entrant.id} className="space-y-2"><EntrantRoster entrant={entrant} seasonId={data.seasonId} locked={locked} />
          {!locked && <Button size="sm" variant="ghost" disabled={isPending} onClick={() => startTransition(() => void showResult(
            () => removeMajorPrestartEntrant({ seasonId: data.seasonId, entrantId: entrant.id }), "已移出正式参赛队集合",
          ))}>移出正式参赛队</Button>}</div>)}
      </div>}
    </Panel>

    <Panel label="资格 blocker 与管理事项">
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
  </div>;
}
