"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { reviewCompetitionEntry } from "@/actions/competition-entries";
import { Checklist, Panel, StatusBanner } from "@/components/rivalhub";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type EntryStatus = "draft" | "submitted" | "changes_requested" | "waitlisted" | "approved" | "rejected" | "withdrawn";
type ParticipantStatus = "invited" | "confirmed" | "declined" | "withdrawn";

interface ReviewEntry {
  id: string;
  name: string;
  source: "linked_team" | "event_native";
  status: EntryStatus;
  reviewReason: string | null;
  perfectTeamId: string | null;
  representativeName: string;
  minRoster: number;
  maxRoster: number;
  starterCount: number;
  qualificationBlockers: string[];
  members: Array<{ participantId: string; userId: string; email: string; label: string; status: ParticipantStatus; primary: boolean; readiness?: { ready: boolean; blockers: string[]; educationApproved: boolean } }>;
}

const STATUS: Record<EntryStatus, string> = {
  draft: "草稿",
  submitted: "待审核",
  changes_requested: "需补正",
  waitlisted: "候补",
  approved: "已批准",
  rejected: "已拒绝",
  withdrawn: "已撤回",
};
const PARTICIPANT_STATUS: Record<ParticipantStatus, string> = {
  invited: "被邀请待确认",
  confirmed: "已确认",
  declined: "已拒绝",
  withdrawn: "已退出",
};

export function CompetitionEntryReviewList({ entries }: { entries: ReviewEntry[] }) {
  const [pending, startTransition] = useTransition();
  const review = (entryId: string, decision: "approved" | "waitlisted" | "changes_requested" | "rejected") => {
    const reason = decision === "changes_requested" || decision === "rejected"
      ? window.prompt(decision === "changes_requested" ? "请填写需补正事项：" : "请填写拒绝原因：")?.trim()
      : undefined;
    if ((decision === "changes_requested" || decision === "rejected") && !reason) return;
    startTransition(async () => {
      const result = await reviewCompetitionEntry({ entryId, decision, reason });
      if (!result.success) toast.error(result.error.message);
      else toast.success(`报名状态已更新为${STATUS[decision]}`);
    });
  };

  if (entries.length === 0) return <StatusBanner tone="info" title="暂无赛事报名" sub="报名草稿创建后会显示在这里。" />;

  return <div className="space-y-5">{entries.map((entry) => {
    const confirmed = entry.members.filter((member) => member.status === "confirmed").length;
    const starters = entry.members.filter((member) => member.primary).length;
    const rosterReady = entry.members.length >= entry.minRoster && entry.members.length <= entry.maxRoster;
    return <Panel key={entry.id} label={`报名审核 · ${entry.name}`} pad={24}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold">{entry.name}</h3><Badge variant="outline">{STATUS[entry.status]}</Badge><Badge variant="outline">{entry.source === "linked_team" ? "长期队伍报名" : "赛事组队"}</Badge></div><p className="mt-2 text-sm text-[var(--color-fg-mid)]">负责人：{entry.representativeName} · 完美战队 ID：{entry.perfectTeamId ?? "未填写"}</p></div>
        {(entry.status === "submitted" || entry.status === "waitlisted") && <div className="flex flex-wrap gap-2"><Button size="sm" disabled={pending} onClick={() => review(entry.id, "approved")}>批准</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => review(entry.id, "waitlisted")}>候补</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => review(entry.id, "changes_requested")}>要求补正</Button><Button size="sm" variant="destructive" disabled={pending} onClick={() => review(entry.id, "rejected")}>拒绝</Button></div>}
      </div>
      {entry.reviewReason && <div className="mt-4"><StatusBanner tone="warn" title="审核说明" sub={entry.reviewReason} /></div>}
      <div className="mt-4"><Checklist items={[
        { label: `报名名单 ${entry.members.length}/${entry.minRoster}–${entry.maxRoster}`, state: rosterReady ? "complete" : "blocked" },
        { label: `成员确认 ${confirmed}/${entry.members.length}`, state: entry.members.length > 0 && confirmed === entry.members.length ? "complete" : "blocked" },
        { label: `预定主力 ${starters}/${entry.starterCount}`, state: starters === entry.starterCount ? "complete" : "blocked" },
        { label: entry.qualificationBlockers.length === 0 ? "资格评估已通过" : `资格 blocker：${entry.qualificationBlockers.join("；")}`, state: entry.qualificationBlockers.length === 0 ? "complete" : "blocked" },
        ...entry.members.map((member) => ({ label: member.readiness ? (member.readiness.ready ? `${member.label} · 学籍与竞技档案已就绪` : `${member.label} · ${member.readiness.blockers.join("；")}`) : `${member.label} · 资格将在审核动作中重新核验`, state: member.readiness?.ready ? "complete" as const : "pending" as const })),
      ]} /></div>
      <div className="mt-4 grid gap-2 lg:grid-cols-2">{entry.members.map((member) => <div key={member.participantId} className="border border-[var(--color-border)] p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{member.label}</span><Badge variant="outline">{PARTICIPANT_STATUS[member.status]}</Badge>{member.primary && <Badge variant="outline">预定主力</Badge>}</div><p className="mt-1 text-xs text-[var(--color-fg-mid)]">学籍：{member.readiness?.educationApproved ? "已通过" : "待核验"} · 竞技档案：{member.readiness ? (member.readiness.ready ? "完整" : "存在 blocker") : "不要求或待审核核验"}</p>{member.readiness && !member.readiness.ready && <p className="mt-1 text-xs text-[var(--color-warn)]">{member.readiness.blockers.join("；")}</p>}</div>)}</div>
    </Panel>;
  })}</div>;
}
