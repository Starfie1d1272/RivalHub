"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { finalizeMajorSwissRound, startMajorPlayoff, transitionMajorSwissStage } from "@/actions/major-prestart";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Marker, Panel } from "@/components/rivalhub";
import type { MajorSwissRuntimeData } from "@/lib/admin/major-runtime";

export type { MajorSwissRuntimeData } from "@/lib/admin/major-runtime";

export function MajorSwissRuntimeManagement({ data }: { data: MajorSwissRuntimeData }) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [hasThirdPlaceMatch, setHasThirdPlaceMatch] = useState(false);
  const [isPending, startTransition] = useTransition();
  const canFinalize = !data.stageComplete && data.currentMatchCount > 0 && data.completedMatchCount === data.currentMatchCount;

  return <Panel label="Swiss 逐轮运行">
    <div className="space-y-4">
      <div>
        <Marker sub={data.stageComplete ? data.nextStageName ? "本阶段已完成，等待进入下一阶段" : "所有 Swiss 阶段已完成" : `当前第 ${data.currentRound} 轮`}>
          {data.stageComplete ? `${data.stageKey} 已完成` : `第 ${data.currentRound} 轮待办赛确认`}
        </Marker>
        <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
          已确认至第 {data.finalizedRound} 轮；本轮 {data.completedMatchCount}/{data.currentMatchCount} 场比赛已完成。确认后会核对本轮比分与对阵，并创建下一轮。
        </p>
      </div>

      {!data.stageComplete && <>
        <label className="flex items-start gap-2 border border-[var(--color-border)] p-3 text-sm text-[var(--color-fg-mid)]">
          <Checkbox checked={confirmed} disabled={!canFinalize || isPending} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>我确认第 {data.currentRound} 轮的所有正式比分已核对无误，并接受其成为后续 Swiss 对阵依据。</span>
        </label>
        <Button disabled={!canFinalize || !confirmed || isPending} onClick={() => startTransition(async () => {
          const result = await finalizeMajorSwissRound({ seasonId: data.seasonId, stageRunId: data.stageRunId, expectedRound: data.currentRound });
          if (!result.success) {
            toast.error(result.error.message);
            return;
          }
          toast.success(result.data.alreadyFinalized
            ? `第 ${data.currentRound} 轮已确认，未重复创建比赛`
            : result.data.stageComplete
              ? `${data.stageKey} Swiss 已完成；请显式确认阶段切换`
              : `第 ${data.currentRound} 轮已确认，已创建 ${result.data.createdNextRound} 场下一轮比赛`);
          setConfirmed(false);
          router.refresh();
        })}>确认本轮并生成下一轮</Button>
        {!canFinalize && <p className="text-xs text-[var(--color-warn)]">下一步：先完成并录入本轮全部比赛的有效比分，才能确认。</p>}
      </>}

      {data.stageComplete && data.nextStageName && <>
        {data.nextStageType === "playoff" && <label className="flex items-start gap-2 border border-[var(--color-border)] p-3 text-sm text-[var(--color-fg-mid)]"><Checkbox checked={hasThirdPlaceMatch} disabled={isPending} onChange={(event) => setHasThirdPlaceMatch(event.target.checked)} /><span>设置季军赛（BO3）。此选择将在淘汰赛创建时冻结；不设置则两支半决赛失利队并列第 3–4 名。</span></label>}
        <label className="flex items-start gap-2 border border-[var(--color-border)] p-3 text-sm text-[var(--color-fg-mid)]">
          <Checkbox checked={confirmed} disabled={isPending} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>我确认本阶段的正式参赛队与全部已确认比赛结果应成为 {data.nextStageName} 的唯一生成依据。</span>
        </label>
        <Button disabled={!confirmed || isPending} onClick={() => startTransition(async () => {
          const result = data.nextStageType === "playoff"
            ? await startMajorPlayoff({ seasonId: data.seasonId, sourceStageRunId: data.stageRunId, hasThirdPlaceMatch })
            : await transitionMajorSwissStage({ seasonId: data.seasonId, sourceStageRunId: data.stageRunId });
          if (!result.success) { toast.error(result.error.message); return; }
          toast.success(result.data.created
            ? `已创建 ${data.nextStageName} 与 ${result.data.matchCount} 场首轮比赛`
            : `${data.nextStageName} 已存在，无需重复创建比赛`);
          setConfirmed(false);
          router.refresh();
        })}>确认切换至 {data.nextStageName}</Button>
      </>}
    </div>
  </Panel>;
}
