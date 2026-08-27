"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  archiveMajorTournament,
  confirmMajorFinalResult,
  createPostEventAdjudication,
  grantTournamentHonor,
  revokePostEventAdjudication,
  revokeTournamentHonor,
} from "@/actions/postevent";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { InlineConfirm, Panel, StatusBanner } from "@/components/rivalhub";

type PlacementGroup = { from: number; to: number; teamIds: string[] };
type Team = { id: string; name: string };

export interface PostEventManagementData {
  seasonId: string;
  seasonStatus: string;
  finalResult: { id: string; status: "pending_confirmation" | "confirmed"; championTeamId: string; placementGroups: PlacementGroup[] } | null;
  teams: Team[];
  honors: Array<{ id: string; honorKey: string; type: string; label: string; state: string; teamId: string | null; userId: string | null; placementFrom: number | null; placementTo: number | null }>;
  adjudications: Array<{ id: string; status: string; kind: string; target: string; impacts: string[]; targetTeamId: string | null; targetUserId: string | null; targetMatchId: string | null; reason: string; explanation: string; createdAt: Date }>;
}

function requestId(): string {
  return crypto.randomUUID();
}

function safeManualKey(value: string): string {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return key || "manual-award";
}

export function PostEventManagement({ data }: { data: PostEventManagementData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState(false);
  const [archiveConfirmed, setArchiveConfirmed] = useState(false);
  const [manualLabel, setManualLabel] = useState("");
  const [manualTeamId, setManualTeamId] = useState("");
  const [placementChoice, setPlacementChoice] = useState("");
  const [adjudicationTeamId, setAdjudicationTeamId] = useState("");
  const [reason, setReason] = useState("");
  const [explanation, setExplanation] = useState("");
  const [internalEvidence, setInternalEvidence] = useState("");
  const [confirming, setConfirming] = useState<{ kind: "honor" | "adjudication"; id: string } | null>(null);
  const teamName = useMemo(() => new Map(data.teams.map((team) => [team.id, team.name])), [data.teams]);
  const runnerUpId = data.finalResult?.placementGroups.find((group) => group.from === 2 && group.to === 2)?.teamIds[0] ?? null;
  const placementOptions = (data.finalResult?.placementGroups ?? [])
    .filter((group) => group.from >= 3)
    .flatMap((group) => group.teamIds.map((teamId) => ({ ...group, teamId, key: `${group.from}:${group.to}:${teamId}` })));

  const run = (work: () => Promise<{ success: boolean; error?: { message: string } }>) => {
    startTransition(async () => {
      const result = await work();
      if (!result.success) { toast.error(result.error?.message ?? "操作失败。"); return; }
      router.refresh();
    });
  };

  const grantResultHonor = (type: "champion" | "runner_up", teamId: string, label: string) => run(async () => {
    const result = await grantTournamentHonor({
      seasonId: data.seasonId,
      clientRequestId: requestId(),
      type,
      label,
      basis: "final_result",
      teamId,
    });
    if (result.success) toast.success(`${label}已作为独立荣誉事实授予。`);
    return result;
  });

  return <div className="grid gap-4">
    <Panel label="最终结果 · 确认" >
      {!data.finalResult ? <p className="text-sm text-[var(--color-fg-mid)]">尚未形成正式最终结果；无法确认、授予基于结果的荣誉或归档。</p> : <div className="space-y-3 text-sm">
        <p>当前状态：<strong>{data.finalResult.status === "confirmed" ? "已确认" : "待确认"}</strong>。冠军：{teamName.get(data.finalResult.championTeamId) ?? data.finalResult.championTeamId}。</p>
        <p className="text-[var(--color-fg-mid)]">名次来源为已持久化的官方 placement groups；确认不会重新计算比赛，也不会修改名次。</p>
        {data.finalResult.status === "pending_confirmation" && <>
          <label className="flex items-start gap-2 border border-[var(--color-border)] p-3">
            <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={isPending} />
            <span>我已核对最终 standings 与 placement groups，并确认将其作为官方赛事结果。</span>
          </label>
          <Button disabled={!confirmed || isPending} onClick={() => run(async () => {
            const result = await confirmMajorFinalResult({ seasonId: data.seasonId });
            if (result.success) toast.success(result.data.alreadyConfirmed ? "赛事结果已确认。" : "赛事结果已正式确认。");
            return result;
          })}>确认最终赛事结果</Button>
        </>}
      </div>}
    </Panel>

    <Panel label="赛事荣誉" >
      <div className="space-y-3 text-sm">
        <p className="text-[var(--color-fg-mid)]">荣誉独立于比赛与名次。撤销冠军不会自动将 Runner-up 提升为 Champion；任何替补授予都必须由管理员另行明确创建。</p>
        {data.finalResult?.status === "confirmed" && <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={isPending} onClick={() => grantResultHonor("champion", data.finalResult!.championTeamId, "Champion")}>授予 Champion</Button>
          {runnerUpId && <Button variant="outline" disabled={isPending} onClick={() => grantResultHonor("runner_up", runnerUpId, "Runner-up")}>授予 Runner-up</Button>}
        </div>}
        {data.finalResult?.status === "confirmed" && placementOptions.length > 0 && <div className="grid gap-2 border border-[var(--color-border)] p-3 md:grid-cols-[1fr_auto]">
          <Select value={placementChoice} onValueChange={setPlacementChoice}><SelectTrigger><SelectValue placeholder="选择官方名次范围与队伍" /></SelectTrigger><SelectContent>{placementOptions.map((option) => <SelectItem key={option.key} value={option.key}>{option.from}–{option.to} · {teamName.get(option.teamId) ?? option.teamId}</SelectItem>)}</SelectContent></Select>
          <Button variant="outline" disabled={!placementChoice || isPending} onClick={() => {
            const selected = placementOptions.find((option) => option.key === placementChoice);
            if (!selected) return;
            run(async () => grantTournamentHonor({ seasonId: data.seasonId, clientRequestId: requestId(), type: "placement", label: `Placement ${selected.from}–${selected.to}`, basis: "final_result", teamId: selected.teamId, placementFrom: selected.from, placementTo: selected.to }));
          }}>授予名次荣誉</Button>
        </div>}
        <div className="grid gap-2 border border-[var(--color-border)] p-3 md:grid-cols-[1fr_1fr_auto]">
          <Input placeholder="手动奖项名称" value={manualLabel} onChange={(event) => setManualLabel(event.target.value)} />
          <Select value={manualTeamId} onValueChange={setManualTeamId}><SelectTrigger><SelectValue placeholder="选择获奖队伍" /></SelectTrigger><SelectContent>{data.teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent></Select>
          <Button disabled={!manualLabel.trim() || !manualTeamId || isPending} onClick={() => run(async () => {
            const result = await grantTournamentHonor({ seasonId: data.seasonId, clientRequestId: requestId(), type: "manual_award", label: manualLabel.trim(), basis: "manual", teamId: manualTeamId, honorKey: safeManualKey(manualLabel) });
            if (result.success) { toast.success("手动奖项已授予。"); setManualLabel(""); setManualTeamId(""); }
            return result;
          })}>授予手动奖项</Button>
        </div>
        {data.honors.length === 0 ? <StatusBanner tone="info" title="尚无荣誉事实" sub="确认最终结果后，管理员可明确授予赛事荣誉。" /> : <ul className="space-y-2">{data.honors.map((honor) => <li key={honor.id} className="flex flex-wrap items-center justify-between gap-2 border border-[var(--color-border)] p-3">
          <span>{honor.label} · {honor.state} · {honor.teamId ? teamName.get(honor.teamId) ?? honor.teamId : honor.userId ?? "未授予"}{honor.placementFrom ? ` · ${honor.placementFrom}–${honor.placementTo}` : ""}</span>
          {honor.state === "valid" && <Button variant="destructive" size="sm" disabled={isPending} onClick={() => setConfirming({ kind: "honor", id: honor.id })}>撤销</Button>}
          {confirming?.kind === "honor" && confirming.id === honor.id && <div className="w-full"><InlineConfirm danger title="撤销此荣誉？" sub="不会自动授予任何其他队伍（包括 Runner-up）。" onCancel={() => setConfirming(null)} onConfirm={() => { setConfirming(null); run(async () => revokeTournamentHonor({ honorId: honor.id, reason: "管理员赛后撤销" })); }} /></div>}
        </li>)}</ul>}
      </div>
    </Panel>

    <Panel label="赛后裁决" >
      <div className="space-y-3 text-sm">
        <p className="text-[var(--color-fg-mid)]">裁决只记录明确的对象和影响范围；不会隐式修改 historical matches、官方名次或荣誉。</p>
        <div className="grid gap-3 border border-[var(--color-border)] p-3">
          <Select value={adjudicationTeamId} onValueChange={setAdjudicationTeamId}><SelectTrigger><SelectValue placeholder="选择被裁决队伍" /></SelectTrigger><SelectContent>{data.teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent></Select>
          <Input placeholder="裁决依据" value={reason} onChange={(event) => setReason(event.target.value)} />
          <Input placeholder="公开说明" value={explanation} onChange={(event) => setExplanation(event.target.value)} />
          <Textarea placeholder="内部证据（仅管理端，绝不经公开 serializer）" value={internalEvidence} onChange={(event) => setInternalEvidence(event.target.value)} />
          <Button disabled={!adjudicationTeamId || !reason.trim() || !explanation.trim() || isPending} onClick={() => run(async () => {
            const result = await createPostEventAdjudication({ seasonId: data.seasonId, clientRequestId: requestId(), kind: "team_sanction", target: "team", targetTeamId: adjudicationTeamId, impacts: ["none"], reason: reason.trim(), publicExplanation: explanation.trim(), internalEvidence: internalEvidence.trim() || null });
            if (result.success) { toast.success("赛后裁决已创建；未修改任何比赛、名次或荣誉。"); setReason(""); setExplanation(""); setInternalEvidence(""); }
            return result;
          })}>创建队伍裁决</Button>
        </div>
        {data.adjudications.length === 0 ? <StatusBanner tone="info" title="尚无赛后裁决" sub="裁决必须明确目标、影响范围与理由，且不会隐式回写历史赛事事实。" /> : <ul className="space-y-2">{data.adjudications.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border border-[var(--color-border)] p-3">
          <span>{item.kind} · {item.status} · {item.target === "team" ? teamName.get(item.targetTeamId ?? "") ?? item.targetTeamId : item.target} · {item.impacts.join(", ")}<br /><span className="text-[var(--color-fg-mid)]">{item.explanation}</span></span>
          {item.status === "active" && <Button variant="destructive" size="sm" disabled={isPending} onClick={() => setConfirming({ kind: "adjudication", id: item.id })}>撤销</Button>}
          {confirming?.kind === "adjudication" && confirming.id === item.id && <div className="w-full"><InlineConfirm danger title="撤销此赛后裁决？" sub="只改变裁决自身状态，不会回写历史比赛、名次或荣誉。" onCancel={() => setConfirming(null)} onConfirm={() => { setConfirming(null); run(async () => revokePostEventAdjudication({ adjudicationId: item.id, reason: "管理员赛后撤销" })); }} /></div>}
        </li>)}</ul>}
      </div>
    </Panel>

    <Panel label="赛事归档" >
      <div className="space-y-3 text-sm">
        <p>当前 archive 状态：<strong>{data.seasonStatus === "archived" ? "已归档" : "未归档"}</strong>。</p>
        {data.seasonStatus !== "archived" && <>
          <p className="text-[var(--color-fg-mid)]">归档后普通赛事运行态变更（名单、开赛/比分、阶段推进、种子与赛事编辑）会在服务端 fail closed。赛后裁决与荣誉撤销仍通过专用 action 允许。</p>
          <label className="flex items-start gap-2 border border-[var(--color-border)] p-3"><Checkbox checked={archiveConfirmed} onChange={(event) => setArchiveConfirmed(event.target.checked)} disabled={isPending} /><span>我确认将赛事进入只读运行态。</span></label>
          <Button variant="destructive" disabled={!archiveConfirmed || isPending} onClick={() => run(async () => {
            const result = await archiveMajorTournament({ seasonId: data.seasonId });
            if (result.success) toast.success(result.data.alreadyArchived ? "赛事已归档。" : "赛事已归档，普通变更已关闭。");
            return result;
          })}>归档赛事</Button>
        </>}
      </div>
    </Panel>
  </div>;
}
