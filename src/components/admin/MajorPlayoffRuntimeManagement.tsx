"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { finalizeMajorPlayoffRound } from "@/actions/major-prestart";
import { Button } from "@/components/ui/button";
import { Marker, Panel } from "@/components/rivalhub";

export interface MajorPlayoffRuntimeData {
  seasonId: string;
  stageRunId: string;
  currentRound: "quarterfinal" | "semifinal" | "final" | null;
  currentMatchCount: number;
  completedMatchCount: number;
  resultPendingConfirmation: boolean;
}

const ROUND_LABEL = { quarterfinal: "八强赛", semifinal: "半决赛", final: "总决赛" } as const;

export function MajorPlayoffRuntimeManagement({ data }: { data: MajorPlayoffRuntimeData }) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const canFinalize = data.currentRound !== null && data.currentMatchCount > 0 && data.currentMatchCount === data.completedMatchCount;

  return <Panel label="淘汰赛运行">
    <div className="space-y-4">
      <Marker sub={data.resultPendingConfirmation ? "冠军与正式名次已生成，等待赛事结果确认" : data.currentRound ? `当前为${ROUND_LABEL[data.currentRound]}` : "托管淘汰赛事实不完整"}>
        {data.resultPendingConfirmation ? "赛事结果待确认" : data.currentRound ? `${ROUND_LABEL[data.currentRound]} 待确认` : "淘汰赛不可确认"}
      </Marker>
      {data.resultPendingConfirmation ? (
        <p className="text-sm text-[var(--color-fg-mid)]">最后一场比赛已形成冠军和正式名次分组；赛事保持待确认，不会静默归档或伪造季军唯一排名。</p>
      ) : data.currentRound && <>
        <p className="text-sm text-[var(--color-fg-mid)]">本轮 {data.completedMatchCount}/{data.currentMatchCount} 场托管比赛已完成。确认会绑定此 StageRun 复核所有比分与上游胜者，再生成下一轮或进入待确认赛事结果。</p>
        <label className="flex items-start gap-2 rounded border border-[var(--color-border)] p-3 text-sm text-[var(--color-fg-mid)]">
          <input type="checkbox" checked={confirmed} disabled={!canFinalize || isPending} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>我确认本轮所有正式比分已核对无误，并接受其成为后续淘汰赛与正式结果的依据。</span>
        </label>
        <Button disabled={!canFinalize || !confirmed || isPending} onClick={() => startTransition(async () => {
          const result = await finalizeMajorPlayoffRound({ seasonId: data.seasonId, stageRunId: data.stageRunId, expectedRound: data.currentRound! });
          if (!result.success) { toast.error(result.error.message); return; }
          toast.success(result.data.alreadyFinalized ? `${ROUND_LABEL[data.currentRound!]} 已确认，未重复创建事实` : result.data.resultPendingConfirmation ? "已生成冠军和正式名次，赛事结果待确认" : `已确认${ROUND_LABEL[data.currentRound!]}，生成 ${result.data.createdNextRound} 场下一轮托管比赛`);
          setConfirmed(false);
          router.refresh();
        })}>确认{ROUND_LABEL[data.currentRound]}</Button>
      </>}
    </div>
  </Panel>;
}
