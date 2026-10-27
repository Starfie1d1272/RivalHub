"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { generateCompetitionQualificationRound as generateAction, previewCompetitionQualificationRound } from "@/actions/competition-qualification";
import { observeAction } from "@/lib/telemetry/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const generateRound = observeAction("competition-qualification.generateCompetitionQualificationRound", generateAction);
type Preview = Extract<Awaited<ReturnType<typeof previewCompetitionQualificationRound>>, { success: true }>["data"];

export function PlayInRoundControl({ seasonId, runId, label = "预览 Play-in 下一轮" }: { seasonId: string; runId: string; label?: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, startTransition] = useTransition();
  return <>
    <Button size="sm" disabled={pending} onClick={() => startTransition(async () => {
      const result = await previewCompetitionQualificationRound({ seasonId, runId });
      if (!result.success) toast.error(result.error.message);
      else setPreview(result.data);
    })}>{label}</Button>
    <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null); }}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>{preview ? `第 ${preview.round} 轮对阵预览` : "Play-in 对阵预览"}</DialogTitle><DialogDescription>{preview?.format === "bo3" ? "Direct BO3" : "Short Swiss BO1"} · 确认后开始本轮比赛</DialogDescription></DialogHeader>
        <DialogBody><ol className="space-y-2">{preview?.matchups.map((matchup, index) => <li key={`${matchup.higherSeedTeamId}:${matchup.lowerSeedTeamId}`} className="flex items-center gap-3 border-b border-[var(--color-border)] py-2 text-sm">
          <span className="w-8 text-[var(--color-fg-dim)]">{index + 1}.</span><span className="min-w-0 flex-1 text-right"><strong>P{matchup.higherSeed}</strong> {matchup.higherSeedTeamName}</span><span className="text-[var(--color-fg-dim)]">vs</span><span className="min-w-0 flex-1"><strong>P{matchup.lowerSeed}</strong> {matchup.lowerSeedTeamName}</span>
        </li>)}</ol></DialogBody>
        <DialogFooter><Button variant="outline" disabled={pending} onClick={() => setPreview(null)}>取消</Button><Button disabled={pending || !preview} onClick={() => {
          if (!preview) return;
          startTransition(async () => {
            const result = await generateRound({ seasonId, runId, expectedPairings: preview.matchups.map(({ higherSeedTeamId, lowerSeedTeamId }) => ({ higherSeedTeamId, lowerSeedTeamId })) });
            if (!result.success) toast.error(result.error.message);
            else { toast.success(result.data.created ? `第 ${result.data.round} 轮对阵已生成` : `第 ${result.data.round} 轮已存在`); setPreview(null); router.refresh(); }
          });
        }}>确认并生成对阵</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
