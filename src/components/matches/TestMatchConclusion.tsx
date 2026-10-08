"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { concludeTestMatch } from "@/actions/test-matches";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mapLabel } from "@/lib/maps";
import { InlineConfirm } from "@/components/rivalhub";

type ResultMap = { id: string; mapName: string; scoreA: number; scoreB: number };
export function TestMatchConclusion({ matchId, finished, disposition, updatedAt, scoreA: initialA, scoreB: initialB, maps }: {
  matchId: string; finished: boolean; disposition: "recorded" | "pending" | "omitted" | null;
  updatedAt: string; scoreA: number | null; scoreB: number | null; maps: ResultMap[];
}) {
  const correction = finished && (disposition !== "pending" || maps.length > 0);
  const [reason, setReason] = useState("");
  const router = useRouter(); const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"recorded" | "pending" | "omitted" | null>(null);
  const [scoreA, setA] = useState(initialA ?? 0); const [scoreB, setB] = useState(initialB ?? 0);
  const [mapScores, setMapScores] = useState(maps);
  const changedMaps = mapScores.filter(map => {
    const original = maps.find(item => item.id === map.id)!;
    return original.scoreA !== map.scoreA || original.scoreB !== map.scoreB;
  }).map(map => ({ mapId: map.id, scoreA: map.scoreA, scoreB: map.scoreB }));
  return <section className="space-y-3 rounded-sm border border-[var(--color-border)] p-4">
    <h2 className="font-semibold">{correction ? "更正测试赛结果" : finished ? "补录测试赛结果" : "结束测试赛"}</h2>
    <div className="flex flex-wrap gap-2"><label className="text-sm">A 方胜场<Input aria-label="A 方胜场" type="number" min={0} max={3} value={scoreA} onChange={event => setA(Number(event.target.value))} className="mt-1 w-20" /></label><label className="text-sm">B 方胜场<Input aria-label="B 方胜场" type="number" min={0} max={3} value={scoreB} onChange={event => setB(Number(event.target.value))} className="mt-1 w-20" /></label></div>
    {correction && mapScores.length > 0 && <fieldset className="space-y-2">
      <legend className="text-sm font-medium">已完成地图比分</legend>
      {mapScores.map(map => <div key={map.id} className="flex flex-wrap items-center gap-2">
        <span className="w-24 text-sm">{mapLabel(map.mapName)}</span>
        {(["scoreA", "scoreB"] as const).map((field, index) => <Input key={field}
          aria-label={`${mapLabel(map.mapName)} ${index === 0 ? "A" : "B"} 方回合数`} type="number" min={0} value={map[field]} className="w-20"
          onChange={event => setMapScores(current => current.map(item => item.id === map.id ? { ...item, [field]: Number(event.target.value) } : item))} />)}
      </div>)}
    </fieldset>}
    {correction && <label className="block text-sm">更正原因<Input value={reason} onChange={event => setReason(event.target.value)} placeholder="说明本次结果更正的原因" className="mt-1" /></label>}
    <div className="flex flex-wrap gap-2"><Button disabled={pending} variant="outline" onClick={() => setKind("recorded")}>{correction ? "保存结果更正" : "提交总比分"}</Button>{!finished && <Button disabled={pending} variant="outline" onClick={() => setKind("pending")}>结束，结果待补</Button>}<Button disabled={pending} variant="outline" onClick={() => setKind("omitted")}>不提交结果</Button></div>
    {kind && !pending && <InlineConfirm title={kind === "recorded" ? `确认测试赛结果 ${scoreA}:${scoreB}？` : kind === "pending" ? "确认结束比赛，稍后补录结果？" : "确认结束比赛且不提交结果？"}
      sub="保留本场 BP、已上传数据和操作记录。结果不会计入正式赛事。"
      onCancel={() => setKind(null)} onConfirm={() => startTransition(async () => {
        const result = await concludeTestMatch(matchId, kind === "recorded" ? { kind, scoreA, scoreB } : { kind }, correction ? { expectedUpdatedAt: updatedAt, reason, maps: changedMaps } : undefined);
        if (!result.success) { toast.error(result.error.message); return; }
        toast.success("测试赛结果已保存"); setKind(null); router.refresh();
      })} />}
    {pending && <p role="status" className="text-sm">正在保存…</p>}
  </section>;
}
