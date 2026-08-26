"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { finalizeMajorSwissRound, startMajorPlayoff, transitionMajorSwissStage } from "@/actions/major-prestart";
import { Button } from "@/components/ui/button";
import { Marker, Panel } from "@/components/rivalhub";

export interface MajorSwissRuntimeData {
  seasonId: string;
  stageRunId: string;
  stageKey: string;
  finalizedRound: 0 | 1 | 2 | 3 | 4 | 5;
  currentRound: 1 | 2 | 3 | 4 | 5;
  currentMatchCount: number;
  completedMatchCount: number;
  stageComplete: boolean;
  nextStageName: string | null;
  nextStageType: "swiss" | "playoff" | null;
}

export function MajorSwissRuntimeManagement({ data }: { data: MajorSwissRuntimeData }) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const canFinalize = !data.stageComplete && data.currentMatchCount > 0 && data.completedMatchCount === data.currentMatchCount;

  return <Panel label="Swiss 逐轮运行">
    <div className="space-y-4">
      <div>
        <Marker sub={data.stageComplete ? data.nextStageName ? "本 StageRun 已完成，等待显式切换下一阶段" : "所有 Swiss 阶段已完成" : `当前第 ${data.currentRound} 轮`}>
          {data.stageComplete ? `${data.stageKey} 已完成` : `第 ${data.currentRound} 轮待办赛确认`}
        </Marker>
        <p className="mt-1 text-sm text-[var(--color-fg-mid)]">
          已确认至第 {data.finalizedRound} 轮；本轮 {data.completedMatchCount}/{data.currentMatchCount} 场比赛已完成。确认会在服务器复核指定 StageRun 的正式比分与 Swiss 对阵事实后，原子生成下一轮。
        </p>
      </div>

      {!data.stageComplete && <>
        <label className="flex items-start gap-2 rounded border border-[var(--color-border)] p-3 text-sm text-[var(--color-fg-mid)]">
          <input type="checkbox" checked={confirmed} disabled={!canFinalize || isPending} onChange={(event) => setConfirmed(event.target.checked)} />
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
        {!canFinalize && <p className="text-xs text-[var(--color-fg-mid)]">必须先完成并录入本轮全部托管比赛的有效正式比分，才能确认。</p>}
      </>}

      {data.stageComplete && data.nextStageName && <>
        <label className="flex items-start gap-2 rounded border border-[var(--color-border)] p-3 text-sm text-[var(--color-fg-mid)]">
          <input type="checkbox" checked={confirmed} disabled={isPending} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>我确认本 StageRun 的 canonical entrants 与全部已确认比赛事实应成为 {data.nextStageName} 的唯一生成依据。</span>
        </label>
        <Button disabled={!confirmed || isPending} onClick={() => startTransition(async () => {
          const result = data.nextStageType === "playoff"
            ? await startMajorPlayoff({ seasonId: data.seasonId, sourceStageRunId: data.stageRunId })
            : await transitionMajorSwissStage({ seasonId: data.seasonId, sourceStageRunId: data.stageRunId });
          if (!result.success) { toast.error(result.error.message); return; }
          toast.success(result.data.created
            ? `已创建 ${data.nextStageName} StageRun 与 ${result.data.matchCount} 场首轮托管比赛`
            : `${data.nextStageName} StageRun 已存在，未重复创建比赛`);
          setConfirmed(false);
          router.refresh();
        })}>确认切换至 {data.nextStageName}</Button>
      </>}
    </div>
  </Panel>;
}
