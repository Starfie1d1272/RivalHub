"use client";

import React, { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmStoredDemoParticipantIdentity, rejectStoredDemoImport, retireGameplaySteamIdentity } from "@/actions/demo-integration";
import { InlineConfirm, Panel } from "@/components/rivalhub";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AdminDemoReviewMap, AdminDemoReviewParticipant } from "@/lib/admin/matches/types";

function ParticipantReview({ importId, participant }: { importId: string; participant: AdminDemoReviewParticipant }) {
  const id = useId();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState("");
  const [reason, setReason] = useState("");
  const [retiring, setRetiring] = useState(false);
  const selected = participant.candidates.find((candidate) => candidate.eventRosterMemberId === selectedId);

  function confirmIdentity() {
    if (!selected || isPending || participant.state !== "confirmable") return;
    startTransition(async () => {
      const result = await confirmStoredDemoParticipantIdentity({ importId, observedSteam64: participant.observedSteam64, eventRosterMemberId: selected.eventRosterMemberId });
      if (result.success) {
        toast.success(result.data.status === "confirmed" ? "比赛 Steam 身份已确认，Demo 数据已重新检查。" : "比赛 Steam 身份已保存，但这份 Demo 仍有其他问题需要处理。");
        setSelectedId("");
        router.refresh();
      } else toast.error(result.error.message);
    });
  }

  function retire() {
    if (isPending || reason.trim().length < 2 || reason.trim().length > 500 || participant.state !== "conflict-retirable" || !participant.retirableIdentityId) return;
    startTransition(async () => {
      const result = await retireGameplaySteamIdentity({ identityId: participant.retirableIdentityId, reason: reason.trim() });
      if (result.success) {
        toast.success("比赛确认产生的 Steam 身份已撤销，请重新核对本场选手。");
        setRetiring(false);
        setReason("");
        router.refresh();
      } else toast.error(result.error.message);
    });
  }

  return (
    <fieldset disabled={isPending} className="min-w-0 space-y-3 rounded border border-[var(--color-border)] p-3 text-sm">
      <legend className="px-1 font-medium">Demo 选手 · {participant.demoName}</legend>
      <p className="break-all font-mono text-xs">Steam64：{participant.observedSteam64}</p>
      <p>队伍：{participant.teamName}</p>
      {participant.currentPlayer && <p>当前关联：<PlayerProfileLink userId={participant.currentPlayer.userId}>{participant.currentPlayer.name}</PlayerProfileLink></p>}
      {participant.state === "confirmable" && (
        <>
          <fieldset className="space-y-2">
            <legend className="mb-2 font-medium">对应本场哪位首发？</legend>
            {participant.candidates.map((candidate) => (
              <label key={candidate.eventRosterMemberId} className="flex cursor-pointer flex-wrap items-center gap-2 rounded bg-[var(--color-bg-soft)] px-3 py-2">
                <input type="radio" name={id} value={candidate.eventRosterMemberId} checked={selectedId === candidate.eventRosterMemberId} onChange={() => setSelectedId(candidate.eventRosterMemberId)} />
                <span>{candidate.name}</span>
                <span className="break-all text-xs text-[var(--color-fg-mid)]">当前 Steam64：{candidate.steam64 ?? "未填写"}</span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs leading-5 text-[var(--color-fg-mid)]">确认后会保存比赛身份并重新检查这份 Demo；其它问题全部解决后才会更新统计。这不会修改登录或报名资料中的 Steam64。</p>
          <Button type="button" size="sm" disabled={!selected || isPending} onClick={confirmIdentity} className="h-auto whitespace-normal break-all">
            {selected ? `确认 ${participant.observedSteam64} 是 ${selected.name}` : "请先选择本场首发"}
          </Button>
        </>
      )}
      {participant.state.startsWith("conflict-") && participant.candidates.length > 0 && (
        <p className="text-xs leading-5">本队首发（需人工核对）：{participant.candidates.map((candidate) => candidate.name).join("、")}</p>
      )}
      {participant.note && <p className="text-sm leading-6 text-[var(--color-fg-mid)]">{participant.note}</p>}
      {participant.state === "conflict-retirable" && (
        <div className="space-y-3">
          <label htmlFor={`${id}-reason`} className="block">撤销原因（2–500 字）</label>
          <Textarea id={`${id}-reason`} value={reason} maxLength={500} onChange={(event) => { setReason(event.target.value); setRetiring(false); }} />
          <Button type="button" variant="outline" size="sm" disabled={reason.trim().length < 2 || isPending} onClick={() => setRetiring(true)}>撤销比赛确认的 Steam 身份</Button>
          {retiring && <InlineConfirm danger title={`确认撤销 ${participant.currentPlayer?.name ?? "该选手"} 的比赛 Steam 身份？`}
            sub="将保留历史来源与审计记录，不修改选手资料中的 Steam64。撤销后刷新页面，再按最新核对结果处理；不会自动改绑或改写历史统计。"
            confirmLabel="确认撤销" onCancel={() => setRetiring(false)} onConfirm={retire} />}
        </div>
      )}
    </fieldset>
  );
}

function MapReview({ review }: { review: AdminDemoReviewMap }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  function reject() {
    if (isPending) return;
    startTransition(async () => {
      const result = await rejectStoredDemoImport({ importId: review.importId });
      if (result.success) {
        toast.success("这份 Demo 数据已拒绝。");
        setRejecting(false);
        router.refresh();
      } else toast.error(result.error.message);
    });
  }
  return (
    <section className="min-w-0 space-y-4 rounded border border-[var(--color-border)] p-4">
      <header>
        <h3 className="font-medium">第 {review.mapOrder} 图 · {review.mapName}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--color-warn)]">{review.message}</p>
      </header>
      {!review.invalidPayload && review.participants.map((participant) => <ParticipantReview key={`${participant.observedSteam64}:${participant.state}`} importId={review.importId} participant={participant} />)}
      {review.resolvedCount > 0 && <p className="text-sm text-[var(--color-fg-mid)]">{review.resolvedCount} 名选手身份已正常匹配</p>}
      {review.blockingIssues.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm leading-6">{review.blockingIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
      <fieldset disabled={isPending} className="space-y-3 border-t border-[var(--color-border)] pt-3">
        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setRejecting(true)}>拒绝这份 Demo 数据</Button>
        {rejecting && <InlineConfirm danger title="确认拒绝这份 Demo 数据？" sub="拒绝后不会写入比赛统计；原始 Demo 数据仍会保留。" confirmLabel="确认拒绝" onCancel={() => setRejecting(false)} onConfirm={reject} />}
      </fieldset>
    </section>
  );
}

export function DemoDataReviewPanel({ reviews = [] }: { reviews?: AdminDemoReviewMap[] }) {
  if (reviews.length === 0) return null;
  return <Panel label="Demo 数据需要处理" contentClassName="space-y-5 p-4">{reviews.map((review) => <MapReview key={review.importId} review={review} />)}</Panel>;
}
