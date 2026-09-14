"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { startMajor } from "@/actions/major-prestart";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Marker, Panel } from "@/components/rivalhub";
import type { MajorOpeningPlan } from "@/lib/major/opening";

export function MajorStartManagement({
  seasonId,
  openingPlan,
  canStart: readinessCanStart,
  started,
}: {
  seasonId: string;
  openingPlan: MajorOpeningPlan | null;
  canStart: boolean;
  started: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const canStart = readinessCanStart && !started;

  return <Panel label="正式开赛确认">
    <div className="space-y-4">
      <div><Marker sub={started ? "Stage 1 已创建" : canStart ? "所有赛前检查已通过，等待管理员确认" : "仍有赛前事项未完成，不能开赛"}>
        {started ? "Major 已正式开赛" : "启动 Stage 1"}
      </Marker>
        <p className="mt-1 text-sm text-[var(--color-fg-mid)]">开始后会再次检查并锁定正式 32 队、最终名单和 1–32 种子，然后创建 Stage 1 首轮。开赛后这些内容不能在此处普通修改。</p>
      </div>

      {openingPlan && <section className="border border-[var(--color-border)] p-3">
        <h3 className="font-medium text-[var(--color-fg)]">开赛安排</h3>
        <p className="mt-1 text-sm leading-6 text-[var(--color-fg-mid)]">
          确认后将按最终种子 #1–8 → Stage 3、#9–16 → Stage 2、#17–32 → Stage 1，创建 {openingPlan.firstRound.pairings.length} 场 Stage 1 首轮比赛。完整对阵预览只在种子编辑区展示。
        </p>
      </section>}

      {!started && <label className="flex items-start gap-2 border border-[var(--color-border)] p-3 text-sm text-[var(--color-fg-mid)]">
        <Checkbox checked={confirmed} disabled={!canStart || isPending} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>我确认上述 32 队、最终名单、种子和首轮对阵；开赛后不能在本控制台普通修改它们。</span>
      </label>}
      {!started && <Button disabled={!canStart || !confirmed || isPending} onClick={() => startTransition(async () => {
        const result = await startMajor({ seasonId });
        if (!result.success) toast.error(result.error.message);
        else toast.success(result.data.created ? `Major 已正式开赛，已创建 ${result.data.matchCount} 场 Stage 1 首轮比赛` : "Major 已经正式开赛，未重复创建比赛");
      })}>正式开始 Major</Button>}
    </div>
  </Panel>;
}
