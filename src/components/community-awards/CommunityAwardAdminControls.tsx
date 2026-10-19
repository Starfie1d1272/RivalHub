"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { configureCommunityAward as telemetry_configureCommunityAward, resolveCommunityAward as telemetry_resolveCommunityAward, verifyCommunityAwardEvidence as telemetry_verifyCommunityAwardEvidence } from "@/actions/community-awards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CommunityAwardModel } from "@/lib/community-awards/data";
import type { SeasonAwardCandidate } from "@/lib/community-awards/read-model";

import { observeAction } from "@/lib/telemetry/client";

const configureCommunityAward = observeAction("community-awards.configureCommunityAward", telemetry_configureCommunityAward);
const resolveCommunityAward = observeAction("community-awards.resolveCommunityAward", telemetry_resolveCommunityAward);
const verifyCommunityAwardEvidence = observeAction("community-awards.verifyCommunityAwardEvidence", telemetry_verifyCommunityAwardEvidence);

const selectClass = "w-full min-w-0 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-sm";
const settlementLabels = { season_complete: "整届结束后", event_verified: "事件达成并核实后", play_in_complete: "Play-in 完成后", stage_complete: "指定正式阶段完成后" };

export function CommunityAwardAdminControls({ award, candidates, stages }: { award: CommunityAwardModel; candidates: SeasonAwardCandidate[]; stages: { key: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [recipientPolicy, setRecipientPolicy] = useState(award.recipientPolicy);
  const [limit, setLimit] = useState(String(award.recipientLimit ?? 3));
  const [settlementPolicy, setSettlementPolicy] = useState(award.settlementPolicy);
  const [stageKey, setStageKey] = useState(award.settlementStageKey ?? stages[0]?.key ?? "");
  const [reason, setReason] = useState("");
  const [recipients, setRecipients] = useState(award.recipients.map(item => item.userId));
  const [status, setStatus] = useState<"awarded" | "not_awarded" | "cancelled">(["awarded", "not_awarded", "cancelled"].includes(award.status) ? award.status as "awarded" | "not_awarded" | "cancelled" : "awarded");
  const [note, setNote] = useState("");
  const run = (work: () => Promise<{ success: boolean; error?: { message: string } }>, message: string) => start(async () => { const result = await work(); if (result.success) toast.success(message); else toast.error(result.error?.message ?? "操作失败。"); });
  const countLabel = award.recipientPolicy === "single" ? "单人获奖" : award.recipientPolicy === "limited" ? `最多 ${award.recipientLimit} 人` : "允许所有并列者获奖";
  return <div className="grid min-w-0 gap-2 border-t border-[var(--color-border)] pt-3">
    <p className="text-xs text-[var(--color-fg-mid)]">{countLabel} · {settlementLabels[award.settlementPolicy]}{award.settlementStageKey ? `（${stages.find(stage => stage.key === award.settlementStageKey)?.name ?? award.settlementStageKey}）` : ""}</p>
    <details><summary className="cursor-pointer text-sm">设置 / 更正结奖规则</summary><div className="mt-2 grid gap-2">
      <select aria-label="获奖人数策略" className={selectClass} value={recipientPolicy} onChange={event => setRecipientPolicy(event.target.value as typeof recipientPolicy)}><option value="single">单人</option><option value="limited">指定人数上限</option><option value="all_ties">所有并列者</option></select>
      {recipientPolicy === "limited" && <Input aria-label="获奖人数上限" type="number" min={2} value={limit} onChange={event => setLimit(event.target.value)} />}
      <select aria-label="结算时机" className={selectClass} value={settlementPolicy} onChange={event => setSettlementPolicy(event.target.value as typeof settlementPolicy)}>{Object.entries(settlementLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      {settlementPolicy === "stage_complete" && <select aria-label="结算正式阶段" className={selectClass} value={stageKey} onChange={event => setStageKey(event.target.value)}><option value="">请选择阶段</option>{stages.map(stage => <option key={stage.key} value={stage.key}>{stage.name}</option>)}</select>}
      <Textarea aria-label="规则设置或更正理由" placeholder="规则设置或更正理由" value={reason} onChange={event => setReason(event.target.value)} />
      <Button size="sm" disabled={pending || !reason.trim() || (settlementPolicy === "stage_complete" && !stageKey)} onClick={() => run(() => configureCommunityAward({ awardId: award.id, recipientPolicy, recipientLimit: recipientPolicy === "single" ? 1 : recipientPolicy === "limited" ? Number(limit) : null, settlementPolicy, settlementStageKey: settlementPolicy === "stage_complete" ? stageKey : null, reason, expectedVersion: award.resultVersion }), "结奖规则已保存。")}>保存规则</Button>
    </div></details>
    {award.status !== "pending_review" && <>
      <p className="text-sm font-medium">记录或更正最终结果</p>
      {!award.settlementReady && <p role="status" className="text-xs text-[var(--color-fg-mid)]">尚未到结奖时机；已核验候选不等于最终获奖。</p>}
      <select aria-label="最终结果" className={selectClass} value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="awarded">确认获奖者</option><option value="not_awarded">本届不颁</option><option value="cancelled">取消</option></select>
      {status === "awarded" && (award.recipientPolicy === "single" ? <select aria-label="选择获奖者" className={selectClass} value={recipients[0] ?? ""} onChange={event => setRecipients(event.target.value ? [event.target.value] : [])}><option value="">选择获奖者</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select> : <fieldset className="max-h-44 overflow-auto border border-[var(--color-border)] p-2"><legend className="text-xs">获奖名单 · 已选 {recipients.length} 人</legend>{candidates.map(candidate => <label key={candidate.id} className="flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" checked={recipients.includes(candidate.id)} onChange={event => setRecipients(event.target.checked ? [...recipients, candidate.id] : recipients.filter(id => id !== candidate.id))} />{candidate.name}</label>)}</fieldset>)}
      <Textarea aria-label="结果说明" placeholder="结果或更正理由" value={note} onChange={event => setNote(event.target.value)} />
      <Button size="sm" disabled={pending || !note.trim() || (status !== "cancelled" && !(status === "awarded" ? award.settlementReady : award.nonAwardingReady ?? award.settlementReady)) || (status === "awarded" && (!recipients.length || (award.recipientLimit !== null && recipients.length > award.recipientLimit)))} onClick={() => run(() => resolveCommunityAward({ awardId: award.id, status, recipientUserIds: status === "awarded" ? recipients : [], outcomeNote: note, expectedVersion: award.resultVersion }), "社区奖最终结果已记录。")}>保存结果</Button>
    </>}
  </div>;
}

export function CommunityAwardEvidenceReview({ award, item }: { award: CommunityAwardModel; item: NonNullable<CommunityAwardModel["evidence"]>[number] }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const submit = (status: "eligible" | "ineligible") => start(async () => {
    const result = await verifyCommunityAwardEvidence({ awardId: award.id, evidenceId: item.id, status, note, expectedVersion: award.resultVersion });
    if (result.success) toast.success("候选核验已保存。"); else toast.error(result.error?.message ?? "核验失败。");
  });
  return <div className="mt-2 grid gap-2">
    <p>{({ pending: "待核验", eligible: "符合条件", ineligible: "不符合条件" })[item.verificationStatus]}{item.verifiedByName ? ` · ${item.verifiedByName}` : ""}{item.verifiedAt ? ` · ${item.verifiedAt}` : ""}</p>
    {item.verificationNote && <p>核验备注：{item.verificationNote}</p>}
    <Textarea aria-label="候选核验或更正理由" placeholder="候选核验或更正理由" value={note} onChange={event => setNote(event.target.value)} />
    <div className="flex flex-wrap gap-2"><Button size="sm" disabled={pending || !note.trim()} onClick={() => submit("eligible")}>符合条件</Button><Button size="sm" variant="outline" disabled={pending || !note.trim()} onClick={() => submit("ineligible")}>不符合条件</Button></div>
  </div>;
}
