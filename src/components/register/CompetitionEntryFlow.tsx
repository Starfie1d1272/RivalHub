"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  confirmCompetitionEntryParticipation,
  createCompetitionEntry,
  declineCompetitionEntryParticipation,
  requestCompetitionEntryRosterChange,
  saveCompetitionEntryRoster,
  submitCompetitionEntry,
  transferCompetitionEntryRepresentative,
  withdrawCompetitionEntry,
  withdrawCompetitionEntryParticipation,
} from "@/actions/competition-entries";
import { Checklist, Panel, StatusBanner } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  presentCompetitionEntryParticipation,
  presentCompetitionEntryRegistration,
  type CompetitionEntryParticipantStatus,
  type CompetitionEntryRegistrationStatus,
} from "@/lib/competition-entries/presentation";
import { CS2_POSITION_LABELS, CS2_POSITION_VALUES, type Cs2Position } from "@/lib/config/cs2-positions";
import type { QualificationFinding } from "@/lib/qualification/service";

type Role = Cs2Position;
type Readiness = { ready: boolean; blockers: string[]; findings: QualificationFinding[]; educationApproved: boolean };
type Candidate = { membershipId: string; userId: string; label: string; status: "active" | "benched"; roles: Role[]; primaryRole: Role | null; readiness?: Readiness };
type RosterMember = Candidate & { participantId: string; confirmation: CompetitionEntryParticipantStatus; primary: boolean };

const ROLE: Record<Role, string> = Object.fromEntries(
  Object.entries(CS2_POSITION_LABELS).map(([role, label]) => [role, label.en]),
) as Record<Role, string>;

interface Props {
  competitionId: string;
  competitionName: string;
  currentUserId: string;
  minRoster: number;
  maxRoster: number;
  starterCount: number;
  requiresPerfectTeamId: boolean;
  captainedTeams: Array<{ id: string; name: string }>;
  entry: null | {
    id: string;
    name: string;
    status: CompetitionEntryRegistrationStatus;
    representativeUserId: string;
    perfectTeamId: string | null;
    reviewReason: string | null;
    qualificationFindings: QualificationFinding[];
    roster: RosterMember[];
    candidates: Candidate[];
  };
}

export function CompetitionEntryFlow(props: Props) {
  const [pending, startTransition] = useTransition();
  const [teamId, setTeamId] = useState(props.captainedTeams[0]?.id ?? "");
  const [perfectTeamId, setPerfectTeamId] = useState(props.entry?.perfectTeamId ?? "");
  const [selected, setSelected] = useState(() => props.entry?.roster.map((member) => member.userId) ?? []);
  const [starters, setStarters] = useState(() => props.entry?.roster.filter((member) => member.primary).map((member) => member.userId) ?? []);

  const run = (work: () => Promise<{ success: boolean; error?: { message: string } }>, message: string) => startTransition(async () => {
    const result = await work();
    if (result.success) toast.success(message);
    else toast.error(result.error?.message ?? "操作失败");
  });

  if (!props.entry) {
    if (props.captainedTeams.length === 0) return <Panel pad={24}><StatusBanner tone="info" title="先创建队伍" sub="报名需要由一支你担任队长的队伍发起。队伍人数可以之后再补齐。" /><Button asChild className="mt-4"><Link href="/my/teams">前往我的队伍</Link></Button></Panel>;
    return <Panel label="报名参赛" pad={24}><p className="mb-4 text-sm leading-6 text-[var(--color-fg-mid)]">选择你担任队长的队伍，创建本届赛事的报名记录。赛事期间会保留当时的队名和图标。</p><div className="flex flex-wrap gap-2"><Select value={teamId} onValueChange={setTeamId}><SelectTrigger className="min-w-60"><SelectValue /></SelectTrigger><SelectContent>{props.captainedTeams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent></Select><Button disabled={pending || !teamId} onClick={() => run(() => createCompetitionEntry({ competitionId: props.competitionId, teamId }), "报名记录已创建")}>开始报名</Button></div></Panel>;
  }

  const entry = props.entry;
  const representative = entry.representativeUserId === props.currentUserId;
  const own = entry.roster.find((member) => member.userId === props.currentUserId);
  const editable = representative && (entry.status === "draft" || entry.status === "changes_requested");
  const candidates = new Map(entry.candidates.map((candidate) => [candidate.userId, candidate]));
  for (const member of entry.roster) if (!candidates.has(member.userId)) candidates.set(member.userId, member);
  const primaryMembers = starters.map((id) => candidates.get(id)).filter((item): item is Candidate => Boolean(item));
  const roleSet = new Set(primaryMembers.flatMap((member) => member.primaryRole ? [member.primaryRole] : []));
  const roleHint = CS2_POSITION_VALUES.filter((role) => !roleSet.has(role)).map((role) => ROLE[role]);
  const confirmed = entry.roster.filter((member) => member.confirmation === "confirmed").length;
  const blockers = [
    { label: `本届名单 ${selected.length}/${props.minRoster}–${props.maxRoster}`, state: selected.length >= props.minRoster && selected.length <= props.maxRoster ? "complete" as const : "blocked" as const },
    { label: `成员确认 ${confirmed}/${entry.roster.length}`, state: entry.roster.length > 0 && confirmed === entry.roster.length ? "complete" as const : "blocked" as const },
    { label: `预定主力 ${starters.length}/${props.starterCount}`, state: starters.length === props.starterCount ? "complete" as const : "blocked" as const },
    ...(props.requiresPerfectTeamId ? [{ label: perfectTeamId.trim() ? "赛事专属 Team ID 已填写" : "赛事专属 Team ID 未填写", state: perfectTeamId.trim() ? "complete" as const : "blocked" as const }] : []),
    ...(props.requiresPerfectTeamId ? entry.roster.map((member) => ({
      label: member.readiness
        ? (member.readiness.ready ? `${member.label} · 身份、学籍与竞技档案已就绪` : `${member.label} · ${member.readiness.blockers.join("；")}`)
        : `${member.label} · 等待成员确认后核验资格`,
      state: member.readiness?.ready ? "complete" as const : "blocked" as const,
    })) : []),
    ...(entry.qualificationFindings.length > 0 ? [{
      label: entry.qualificationFindings.some((finding) => !finding.waivable)
        ? `资格资料仍不完整：${entry.qualificationFindings.filter((finding) => !finding.waivable).map((finding) => finding.message).join("；")}`
        : `自动资格规则不通过，待赛事管理员解除：${entry.qualificationFindings.map((finding) => finding.message).join("；")}`,
      state: entry.qualificationFindings.some((finding) => !finding.waivable) ? "blocked" as const : "pending" as const,
      detail: "可解除限制不会被显示为系统自动通过；管理员必须针对具体限制留下理由。",
    }] : [{ label: "自动资格规则已通过", state: "complete" as const }]),
    { label: roleHint.length === 0 ? "预定主力角色分布较完整" : `角色软提示：可考虑补充 ${roleHint.join(" / ")}`, state: roleHint.length === 0 ? "complete" as const : "pending" as const, detail: "角色仅用于推荐；重复 AWPer、没有 IGL 或任何角色缺口都不会阻止提交。" },
  ];
  const ready = blockers.filter((item) => item.state !== "pending").every((item) => item.state === "complete");

  const toggleSelected = (userId: string) => {
    setSelected((current) => current.includes(userId) ? current.filter((id) => id !== userId) : current.length < props.maxRoster ? [...current, userId] : current);
    if (selected.includes(userId)) setStarters((current) => current.filter((id) => id !== userId));
  };
  const toggleStarter = (userId: string) => setStarters((current) => current.includes(userId) ? current.filter((id) => id !== userId) : current.length < props.starterCount ? [...current, userId] : current);

  return <div className="space-y-5">
    <StatusBanner tone={entry.status === "approved" ? "success" : entry.status === "changes_requested" ? "warn" : "info"} title={`${entry.name} · ${presentCompetitionEntryRegistration(entry.status).label}`} sub={entry.reviewReason ?? "本届名单以提交后的内容为准；日后的队伍调整不会改变已报名赛事。"} />
    {!representative && <Panel label="我的参赛确认" pad={24}><p className="mb-3 text-sm text-[var(--color-fg-mid)]">加入队伍不等于参加本届赛事。请在这里明确确认是否参赛。</p>{own ? <><p className="mb-3 text-sm font-medium">当前状态：{presentCompetitionEntryParticipation(own.confirmation, entry.status).label}</p>{own.confirmation === "invited" && <div className="flex gap-2"><Button disabled={pending} onClick={() => run(() => confirmCompetitionEntryParticipation({ entryId: entry.id }), "已确认参加本届赛事")}>确认参赛</Button><Button variant="outline" disabled={pending} onClick={() => run(() => declineCompetitionEntryParticipation({ entryId: entry.id }), "已拒绝本届赛事邀请")}>拒绝邀请</Button></div>}{own.confirmation === "confirmed" && entry.status !== "approved" && <Button variant="outline" disabled={pending} onClick={() => run(() => withdrawCompetitionEntryParticipation({ entryId: entry.id }), "已退出本届赛事")}>退出本届赛事</Button>}{(own.confirmation === "declined" || own.confirmation === "withdrawn") && <p className="text-sm text-[var(--color-fg-mid)]">如需参赛，请由赛事负责人将你重新加入本届名单。</p>}</> : <p className="text-sm text-[var(--color-fg-mid)]">你不在当前报名名单中。</p>}</Panel>}
    {representative && <>
      <Panel label="1 · 本届名单" pad={24}><p className="mb-4 text-sm text-[var(--color-fg-mid)]">候选人来自当前队伍。名单保存后不会因队伍日后调整而自动变化。</p><div className="space-y-2">{[...candidates.values()].map((member) => <div key={member.userId} className="flex flex-wrap items-center justify-between gap-3 border border-[var(--color-border)] p-3"><div><p className="text-sm font-medium">{member.label}</p><p className="mt-1 text-xs text-[var(--color-fg-mid)]">{member.status === "active" ? "当前成员" : "替补成员"} · {member.roles.length ? member.roles.map((role) => ROLE[role]).join(" / ") : "未填写常用位置"}</p></div><div className="flex gap-4 text-xs"><label className="flex items-center gap-2"><Checkbox disabled={!editable || pending} checked={selected.includes(member.userId)} onChange={() => toggleSelected(member.userId)} />本届名单</label><label className="flex items-center gap-2"><Checkbox disabled={!editable || pending || !selected.includes(member.userId)} checked={starters.includes(member.userId)} onChange={() => toggleStarter(member.userId)} />预定主力</label></div></div>)}</div><div className="mt-4 space-y-2"><label htmlFor="perfect-team-id" className="text-sm font-medium">赛事专属队伍 ID</label><Input id="perfect-team-id" disabled={!editable} value={perfectTeamId} onChange={(event) => setPerfectTeamId(event.target.value)} /></div>{editable && <Button className="mt-4" variant="outline" disabled={pending} onClick={() => run(() => saveCompetitionEntryRoster({ entryId: entry.id, userIds: selected, primaryStarterUserIds: starters, perfectTeamId }), "本届名单已保存")}>保存本届名单</Button>}</Panel>
      <Panel label="2 · 成员确认" pad={24}><div className="space-y-2">{entry.roster.map((member) => <div key={member.participantId} className="flex items-center justify-between gap-3 border border-[var(--color-border)] px-3 py-2 text-sm"><span>{member.label}{member.primary ? " · 预定主力" : ""}</span><span className={member.confirmation === "confirmed" ? "text-[var(--color-ok)]" : "text-[var(--color-warn)]"}>{presentCompetitionEntryParticipation(member.confirmation, entry.status).label}</span></div>)}</div>{own?.confirmation === "invited" && <Button className="mt-4" disabled={pending} onClick={() => run(() => confirmCompetitionEntryParticipation({ entryId: entry.id }), "你已确认本届参赛")}>确认我本人参赛</Button>}</Panel>
      <Panel label="3 · 报名检查" pad={0}><Checklist items={blockers} />{editable && <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] p-4"><Button disabled={pending || !ready} onClick={() => run(() => submitCompetitionEntry({ entryId: entry.id }), `${props.competitionName} 报名已提交审核`)}>{ready ? "提交报名" : "完成提示后提交"}</Button><Button variant="outline" disabled={pending} onClick={() => run(() => withdrawCompetitionEntry({ entryId: entry.id }), "报名已撤回")}>撤回报名</Button></div>}{entry.status === "approved" && <div className="border-t border-[var(--color-border)] p-4"><Button variant="outline" disabled={pending} onClick={() => run(() => requestCompetitionEntryRosterChange({ entryId: entry.id }), "可以编辑新的名单")}>申请修改名单</Button></div>}</Panel>
      {entry.roster.some((member) => member.confirmation === "confirmed" && member.userId !== entry.representativeUserId) && <Panel label="赛事负责人" pad={24}><p className="mb-3 text-sm text-[var(--color-fg-mid)]">赛事负责人负责本届报名和赛务沟通。更换队长不会自动更改这里的人选。</p><div className="flex flex-wrap gap-2">{entry.roster.filter((member) => member.confirmation === "confirmed" && member.userId !== entry.representativeUserId).map((member) => <Button key={member.userId} size="sm" variant="outline" disabled={pending} onClick={() => run(() => transferCompetitionEntryRepresentative({ entryId: entry.id, toUserId: member.userId }), `赛事负责人已交接给 ${member.label}`)}>交接给 {member.label}</Button>)}</div></Panel>}
    </>}
    <p className="text-xs leading-5 text-[var(--color-fg-mid)]">预定主力用于报名审核；每场比赛的出场阵容会在赛前另行提交并确认。</p>
  </div>;
}
