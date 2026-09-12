"use client";

import { useRef, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { grantCompetitionEntryRestrictionOverride, reviewCompetitionEntry, revokeCompetitionEntryRestrictionOverride } from "@/actions/competition-entries";
import { presentCompetitionEntryRegistration } from "@/lib/competition-entries/presentation";
import {
  Checklist,
  ClearFilters,
  ListSearchField,
  ListToolbar,
  PaginationControls,
  Panel,
  ResultSummary,
  StatusBanner,
  type ListSearchFieldHandle,
  useListQueryParams,
} from "@/components/rivalhub";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { QualificationFinding } from "@/lib/qualification/finding";
import { formatCST } from "@/lib/utils/date";
import {
  TEAM_REGISTRATION_REVIEW_DEFAULTS,
  type TeamRegistrationReviewQuery,
  type TeamRegistrationReviewRow,
} from "@/lib/registrations/admin-review-contract";

type ReviewEntry = TeamRegistrationReviewRow;
type ParticipantStatus = ReviewEntry["members"][number]["status"];

const PARTICIPANT_STATUS: Record<ParticipantStatus, string> = {
  invited: "被邀请待确认",
  confirmed: "已确认",
  declined: "已拒绝",
  withdrawn: "已退出",
};

const STATUS_OPTIONS = [
  { value: "submitted", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "waitlisted", label: "候补" },
  { value: "changes_requested", label: "需补正" },
  { value: "rejected", label: "未通过" },
  { value: "withdrawn", label: "已撤回" },
  { value: "all", label: "全部状态" },
] as const;

const QUALIFICATION_OPTIONS = [
  { value: "all", label: "全部资格" },
  { value: "ready", label: "资格已通过" },
  { value: "blocked", label: "资格待处理" },
] as const;

const SORT_OPTIONS = [
  { value: "oldest", label: "最早提交" },
  { value: "newest_updated", label: "最近更新" },
] as const;

const SELECT_CLASS_NAME = "min-w-0 max-w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-panel-low)] px-3 py-2 text-sm text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]";

export function CompetitionEntryReviewList({
  seasonSlug,
  entries,
  total,
  page,
  pageSize,
  totalPages,
  normalizedQuery,
  hasAnyRecords,
  startedCount,
  draftCount,
}: {
  seasonSlug: string;
  entries: ReviewEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  normalizedQuery: TeamRegistrationReviewQuery;
  hasAnyRecords: boolean;
  startedCount: number;
  draftCount: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { update } = useListQueryParams({
    routeBase: `/admin/${seasonSlug}/registrations`,
    defaults: TEAM_REGISTRATION_REVIEW_DEFAULTS,
  });
  const searchFieldRef = useRef<ListSearchFieldHandle>(null);
  const [pending, startTransition] = useTransition();
  const review = (entryId: string, decision: "approved" | "waitlisted" | "changes_requested" | "rejected") => {
    const reason = decision === "changes_requested" || decision === "rejected"
      ? window.prompt(decision === "changes_requested" ? "请填写需补正事项：" : "请填写拒绝原因：")?.trim()
      : undefined;
    if ((decision === "changes_requested" || decision === "rejected") && !reason) return;
    startTransition(async () => {
      const result = await reviewCompetitionEntry({ entryId, decision, reason });
      if (!result.success) toast.error(result.error.message);
      else {
        toast.success(`报名状态已更新为${presentCompetitionEntryRegistration(decision).label}`);
        router.refresh();
      }
    });
  };

  const grantOverride = (entry: ReviewEntry, finding: QualificationFinding) => {
    if (!finding.waivable) return;
    const reason = window.prompt(`请填写解除“${finding.message}”的具体理由：`)?.trim();
    if (!reason) return;
    startTransition(async () => {
      const result = await grantCompetitionEntryRestrictionOverride({ entryId: entry.id, restrictionCode: finding.code, reason });
      if (!result.success) toast.error(result.error.message);
      else {
        toast.success("资格限制已解除并记录审计");
        router.refresh();
      }
    });
  };

  const revokeOverride = (entry: ReviewEntry, finding: QualificationFinding) => {
    startTransition(async () => {
      const result = await revokeCompetitionEntryRestrictionOverride({ entryId: entry.id, restrictionCode: finding.code });
      if (!result.success) toast.error(result.error.message);
      else {
        toast.success("资格限制解除已撤销");
        router.refresh();
      }
    });
  };

  const requestedStatus = searchParams.get("status");
  const currentStatus = STATUS_OPTIONS.some((option) => option.value === requestedStatus)
    ? requestedStatus as TeamRegistrationReviewQuery["status"]
    : normalizedQuery.status;
  const requestedQualification = searchParams.get("qualification");
  const currentQualification = QUALIFICATION_OPTIONS.some((option) => option.value === requestedQualification)
    ? requestedQualification as TeamRegistrationReviewQuery["qualification"]
    : normalizedQuery.qualification;
  const requestedSort = searchParams.get("sort");
  const currentSort = SORT_OPTIONS.some((option) => option.value === requestedSort)
    ? requestedSort as TeamRegistrationReviewQuery["sort"]
    : normalizedQuery.sort;

  return <div className="space-y-5">
    <ListToolbar className="items-start" aria-label="队伍报名搜索与筛选">
      <ListSearchField
        ref={searchFieldRef}
        queryKey="q"
        label="搜索队伍报名"
        placeholder="队伍名 / 负责人姓名 / 邮箱…"
        value={searchParams.get("q") ?? ""}
        onDebouncedChange={(value) => update({ q: value })}
        className="min-w-0 w-full flex-1 basis-full lg:basis-[36%]"
      />
      <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[20%]">
        <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">状态</span>
        <select aria-label="队伍报名状态" value={currentStatus} onChange={(event) => update({ status: event.target.value })} className={SELECT_CLASS_NAME}>
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[20%]">
        <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">资格</span>
        <select aria-label="队伍资格状态" value={currentQualification} onChange={(event) => update({ qualification: event.target.value })} className={SELECT_CLASS_NAME}>
          {QUALIFICATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label className="min-w-0 w-full flex-1 basis-full sm:basis-[calc(50%-0.75rem)] lg:basis-[16%]">
        <span className="mb-1.5 block text-xs text-[var(--color-fg-mid)]">排序</span>
        <select aria-label="队伍报名排序" value={currentSort} onChange={(event) => update({ sort: event.target.value })} className={SELECT_CLASS_NAME}>
          {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <ClearFilters
        defaults={TEAM_REGISTRATION_REVIEW_DEFAULTS}
        searchParams={searchParams}
        onClear={(updates) => {
          searchFieldRef.current?.reset();
          update(updates);
        }}
      />
    </ListToolbar>

    {entries.length === 0 ? (
      <StatusBanner
        tone="info"
        title={hasAnyRecords ? "没有符合当前筛选条件的报名" : draftCount > 0 ? "暂时没有队伍提交审核" : "暂无队伍提交审核"}
        sub={hasAnyRecords ? "请调整搜索、状态或资格筛选。" : draftCount > 0 ? `已有 ${draftCount} 支队伍正在填写报名。` : startedCount > 0 ? "已开始的报名当前处于其它状态。" : "尚无队伍开始报名。"}
      />
    ) : <div className="space-y-5">{entries.map((entry) => {
    const confirmed = entry.members.filter((member) => member.status === "confirmed").length;
    const starters = entry.members.filter((member) => member.primary).length;
    const rosterReady = entry.members.length >= entry.minRoster && entry.members.length <= entry.maxRoster;
    return <Panel key={entry.id} label={`报名审核 · ${entry.name}`} contentClassName="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold">{entry.name}</h3><Badge variant="outline">{presentCompetitionEntryRegistration(entry.status).label}</Badge><Badge variant="outline">{entry.source === "linked_team" ? "队伍报名" : "赛事组队"}</Badge></div><p className="mt-2 text-sm text-[var(--color-fg-mid)]">负责人：{entry.representativeName} · 完美战队 ID（可选）：{entry.perfectTeamId ?? "未填写"}</p></div>
        {(entry.status === "submitted" || entry.status === "waitlisted") && <div className="flex flex-wrap gap-2"><Button size="sm" disabled={pending} onClick={() => review(entry.id, "approved")}>批准</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => review(entry.id, "waitlisted")}>候补</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => review(entry.id, "changes_requested")}>要求补正</Button><Button size="sm" variant="destructive" disabled={pending} onClick={() => review(entry.id, "rejected")}>拒绝</Button></div>}
      </div>
      {entry.reviewReason && <div className="mt-4"><StatusBanner tone="warn" title="审核说明" sub={entry.reviewReason} /></div>}
      {entry.qualificationFindings.length > 0 && <div className="mt-4 space-y-2">
        {entry.qualificationFindings.map((finding, index) => {
          const override = finding.waivable ? entry.activeRestrictionOverrides.find((candidate) => candidate.restrictionCode === finding.code) : undefined;
          return <div key={`${finding.code}-${index}`} className="border border-[var(--color-border)] p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><Badge variant="outline">{finding.waivable ? "可解除政策限制" : "资料/事实不足，不可解除"}</Badge><p className="mt-2 font-medium">{finding.message}</p></div>
              {finding.waivable && (override ? <Button size="sm" variant="outline" disabled={pending} onClick={() => revokeOverride(entry, finding)}>撤销解除</Button> : <Button size="sm" disabled={pending} onClick={() => grantOverride(entry, finding)}>解除限制</Button>)}
            </div>
            {override && <>
              <p className={`mt-2 text-xs ${override.snapshotMatches ? "text-[var(--color-ok)]" : "text-[var(--color-warn)]"}`}>
                {override.snapshotMatches ? "已解除" : "解除记录对应的资格事实已变化，请先撤销旧记录后重新确认"}：{override.reason} · 操作者 {override.grantedBy} · {formatCST(override.grantedAt)}
              </p>
              <p className="mt-1 text-xs text-[var(--color-fg-dim)]">解除记录会保留资格判断依据，供后续复核。</p>
            </>}
          </div>;
        })}
      </div>}
      <div className="mt-4"><Checklist items={[
        { label: `报名名单 ${entry.members.length}/${entry.minRoster}–${entry.maxRoster}`, state: rosterReady ? "complete" : "blocked" },
        { label: `成员确认 ${confirmed}/${entry.members.length}`, state: entry.members.length > 0 && confirmed === entry.members.length ? "complete" : "blocked" },
        { label: `预定主力 ${starters}/${entry.starterCount}`, state: starters === entry.starterCount ? "complete" : "blocked" },
        { label: entry.qualificationFindings.length === 0 ? "资格评估已通过" : entry.qualificationFindings.some((finding) => !finding.waivable) ? `资格资料仍不完整：${entry.qualificationBlockers.join("；")}` : entry.qualificationFindings.every((finding) => entry.activeRestrictionOverrides.some((override) => override.restrictionCode === finding.code && override.snapshotMatches)) ? "自动资格规则不通过，但限制已逐条解除" : `待解除资格限制：${entry.qualificationBlockers.join("；")}`, state: entry.qualificationFindings.some((finding) => !finding.waivable) || entry.qualificationFindings.some((finding) => finding.waivable && !entry.activeRestrictionOverrides.some((override) => override.restrictionCode === finding.code && override.snapshotMatches)) ? "blocked" : "complete" },
        ...entry.members.map((member) => ({ label: member.readiness ? (member.readiness.ready ? `${member.label} · 学籍与竞技档案已就绪` : `${member.label} · ${member.readiness.blockers.join("；")}`) : `${member.label} · 资格将在审核动作中重新核验`, state: member.readiness?.ready ? "complete" as const : "pending" as const })),
      ]} /></div>
      <div className="mt-4 grid gap-2 lg:grid-cols-2">{entry.members.map((member) => <div key={member.participantId} className="border border-[var(--color-border)] p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{member.label}</span><Badge variant="outline">{PARTICIPANT_STATUS[member.status]}</Badge>{member.primary && <Badge variant="outline">预定主力</Badge>}</div><p className="mt-1 text-xs text-[var(--color-fg-mid)]">学籍：{member.readiness?.educationApproved ? "已通过" : "待核验"} · 竞技档案：{member.readiness ? (member.readiness.ready ? "完整" : "存在未满足项") : "不要求或待审核核验"}</p>{member.readiness && !member.readiness.ready && <p className="mt-1 text-xs text-[var(--color-warn)]">{member.readiness.blockers.join("；")}</p>}</div>)}</div>
    </Panel>;
    })}</div>}
    <div className="flex justify-between gap-3">
      <ResultSummary total={total} page={page} pageSize={pageSize} totalPages={totalPages} />
    </div>
    <PaginationControls
      page={page}
      totalPages={totalPages}
      onPageChange={(nextPage) => update({ page: nextPage }, { defaults: { page: 1 }, history: "push" })}
    />
  </div>;
}
