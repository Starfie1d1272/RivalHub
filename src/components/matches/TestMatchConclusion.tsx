"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { concludeTestMatch } from "@/actions/test-matches";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineConfirm } from "@/components/rivalhub";

export function TestMatchConclusion({ matchId, finished, disposition, updatedAt }: { matchId: string; finished: boolean; disposition: "recorded" | "pending" | "omitted" | null; updatedAt: string }) {
  const correction = finished && disposition !== "pending";
  const [reason, setReason] = useState("");
  const router = useRouter(); const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"recorded" | "pending" | "omitted" | null>(null);
  const [scoreA, setA] = useState(0); const [scoreB, setB] = useState(0);
  return <section className="space-y-3 rounded-sm border border-[var(--color-border)] p-4">
    <h2 className="font-semibold">{correction ? "更正测试赛结果" : finished ? "补录测试赛结果" : "结束测试赛"}</h2>
    <div className="flex flex-wrap gap-2"><label className="text-sm">A 方胜场<Input aria-label="A 方胜场" type="number" min={0} max={3} value={scoreA} onChange={event => setA(Number(event.target.value))} className="mt-1 w-20" /></label><label className="text-sm">B 方胜场<Input aria-label="B 方胜场" type="number" min={0} max={3} value={scoreB} onChange={event => setB(Number(event.target.value))} className="mt-1 w-20" /></label></div>
    {correction && <label className="block text-sm">更正原因<Input value={reason} onChange={event => setReason(event.target.value)} placeholder="说明本次结果更正的原因" className="mt-1" /></label>}
    <div className="flex flex-wrap gap-2"><Button disabled={pending} variant="outline" onClick={() => setKind("recorded")}>提交总比分</Button>{!finished && <Button disabled={pending} variant="outline" onClick={() => setKind("pending")}>结束，结果待补</Button>}<Button disabled={pending} variant="outline" onClick={() => setKind("omitted")}>不提交结果</Button></div>
    {kind && !pending && <InlineConfirm title={kind === "recorded" ? `确认测试赛结果 ${scoreA}:${scoreB}？` : kind === "pending" ? "确认结束比赛，稍后补录结果？" : "确认结束比赛且不提交结果？"}
      sub="保留本场 BP、已上传数据和操作记录。结果不会计入正式赛事。"
      onCancel={() => setKind(null)} onConfirm={() => startTransition(async () => {
        const result = await concludeTestMatch(matchId, kind === "recorded" ? { kind, scoreA, scoreB } : { kind }, correction ? { expectedUpdatedAt: updatedAt, reason } : undefined);
        if (!result.success) { toast.error(result.error.message); return; }
        toast.success("测试赛结果已保存"); setKind(null); router.refresh();
      })} />}
    {pending && <p role="status" className="text-sm">正在保存…</p>}
  </section>;
}
