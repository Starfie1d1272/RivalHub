"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { CommunityAwardAdminSummary, CommunityAwardModel } from "@/lib/community-awards/data";
import { readCommunityAwardDetail, readCommunityAwardOptions } from "@/app/admin/[seasonSlug]/community-awards/actions";
import { Button } from "@/components/ui/button";

const AwardBoard = dynamic(() => import("@/components/community-awards/CommunityAwardsBoard").then(module => module.CommunityAwardsBoard));
type Options = Extract<Awaited<ReturnType<typeof readCommunityAwardOptions>>, { success: true }>["data"];
type Props = { seasonId: string; currentUserId: string; summaries: CommunityAwardAdminSummary[]; stages: { key: string; name: string }[] };

export function AdminCommunityAwardsWorkspace({ seasonId, currentUserId, summaries, stages }: Props) {
  // One form-only read per RSC snapshot, shared by all expanded awards.
  const shared = useRef<{ seasonId: string; viewerId: string; snapshot: CommunityAwardAdminSummary[]; pending: Promise<Options> | null } | null>(null);
  const options = useCallback(() => {
    let slot = shared.current;
    if (!slot || slot.seasonId !== seasonId || slot.viewerId !== currentUserId || slot.snapshot !== summaries) {
      slot = { seasonId, viewerId: currentUserId, snapshot: summaries, pending: null };
      shared.current = slot;
    }
    const current = slot;
    return current.pending ??= readCommunityAwardOptions(seasonId).then(result => {
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    }).catch(error => { current.pending = null; throw error; });
  }, [currentUserId, seasonId, summaries]);
  const groups = [
    { label: "待审核", awards: summaries.filter(award => award.status === "pending_review" || award.status === "rejected") },
    { label: "已公开待结奖", awards: summaries.filter(award => award.status === "approved") },
    { label: "已结束", awards: summaries.filter(award => ["awarded", "not_awarded", "cancelled", "withdrawn"].includes(award.status)) },
  ];
  return <div className="space-y-6">{groups.map(group => <section key={group.label} className="space-y-3">
    <h2 className="text-lg font-semibold">{group.label}</h2>
    {group.awards.length === 0 && <p className="text-sm text-[var(--color-fg-mid)]">暂无此状态的社区奖</p>}
    {group.awards.map(summary => <AwardDetails key={summary.id} summary={summary} seasonId={seasonId} currentUserId={currentUserId} stages={stages} options={options} />)}
  </section>)}</div>;
}

function AwardDetails({ summary, seasonId, currentUserId, stages, options }: Omit<Props, "summaries"> & {
  summary: CommunityAwardAdminSummary; options: () => Promise<Options>;
}) {
  const [active, setActive] = useState(false);
  const [attempt, setAttempt] = useState(0);
  type Identity = { summary: CommunityAwardAdminSummary; options: () => Promise<Options>; attempt: number };
  const [data, setData] = useState<(Identity & { award: CommunityAwardModel; form: Options }) | null>(null);
  const [failure, setFailure] = useState<(Identity & { message: string }) | null>(null);
  const current = (identity: Identity | null) => identity?.summary === summary && identity.options === options && identity.attempt === attempt;
  const error = current(failure) ? failure!.message : null;
  const fresh = current(data) && !error;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const identity = { summary, options, attempt };
    void Promise.all([readCommunityAwardDetail({ seasonId, awardId: summary.id }), options()]).then(([detail, form]) => {
      if (cancelled) return;
      if (detail.success) { setData({ ...identity, award: detail.data, form }); setFailure(null); }
      else setFailure({ ...identity, message: detail.error.message });
    }).catch(error => { if (!cancelled) setFailure({ ...identity, message: error instanceof Error ? error.message : "暂时无法读取社区奖详情，请重试。" }); });
    return () => { cancelled = true; };
  }, [active, attempt, options, seasonId, summary]);
  return <details className="rounded border border-[var(--color-border)] p-4" onToggle={event => { if (event.currentTarget.open) setActive(true); }}>
    <summary className="cursor-pointer"><strong>{summary.name}</strong> · {summary.prize} · {summary.evidenceCount} 条证据（{summary.eligibleEvidenceCount} 条有效） · 查看审核与结奖</summary>
    {active && !fresh && !error && <p role="status">正在读取社区奖核对资料…{data ? "草稿已保留，暂不可操作。" : ""}</p>}
    {error && <p role="alert">{error}<Button size="sm" variant="outline" onClick={() => setAttempt(value => value + 1)}>重试</Button></p>}
    {data && <fieldset disabled={!fresh} className="min-w-0 pt-3"><AwardBoard seasonId={seasonId} awards={[data.award]} currentUserId={currentUserId} isAdmin candidates={data.form.candidates} matches={data.form.matches} stages={stages} allowSubmission={false} /></fieldset>}
  </details>;
}
