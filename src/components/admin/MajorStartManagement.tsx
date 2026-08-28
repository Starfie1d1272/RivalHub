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
      <div><Marker sub={started ? "Stage 1 已创建，重复操作只会返回既有运行记录" : canStart ? "所有赛前检查已通过，等待管理员确认" : "赛前 blocker 未清除，不能开赛"}>
        {started ? "Major 已正式开赛" : "启动 Stage 1"}
      </Marker>
        <p className="mt-1 text-sm text-[var(--color-fg-mid)]">执行时服务器会在同一事务中再次复核 readiness，再锁定正式 32 队、最终名单和 1–32 种子，固化规则快照，并创建 Stage 1 首轮。</p>
      </div>

      {openingPlan && <>
        <section className="grid gap-3 md:grid-cols-3">
          <Cohort label="Stage 3 直入" range="#1–8" count={openingPlan.stage3.directEntrants.length} />
          <Cohort label="Stage 2 直入" range="#9–16" count={openingPlan.stage2.directEntrants.length} />
          <Cohort label="Stage 1 参赛" range="#17–32" count={openingPlan.stage1.entrants.length} />
        </section>
        <section>
          <h3 className="font-medium text-[var(--color-fg)]">将创建的 Stage 1 R1 托管比赛（8 场）</h3>
          <ol className="mt-2 grid gap-2 text-sm md:grid-cols-2">
            {openingPlan.firstRound.pairings.map((pairing, index) => <li key={`${pairing.higherSeed.teamId}-${pairing.lowerSeed.teamId}`} className="border border-[var(--color-border)] px-3 py-2">
              {index + 1}. #{pairing.higherSeed.tournamentSeed} vs #{pairing.lowerSeed.tournamentSeed} · {pairing.format.toUpperCase()}
            </li>)}
          </ol>
        </section>
      </>}

      {!started && <label className="flex items-start gap-2 border border-[var(--color-border)] p-3 text-sm text-[var(--color-fg-mid)]">
        <Checkbox checked={confirmed} disabled={!canStart || isPending} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>我确认上述 32 队、最终名单、种子和首轮对阵应成为正式赛事事实；开赛后不能在本控制台修改它们。</span>
      </label>}
      {!started && <Button disabled={!canStart || !confirmed || isPending} onClick={() => startTransition(async () => {
        const result = await startMajor({ seasonId });
        if (!result.success) toast.error(result.error.message);
        else toast.success(result.data.created ? `Major 已正式开赛，已创建 ${result.data.matchCount} 场 Stage 1 首轮比赛` : "Major 已经正式开赛，未重复创建比赛");
      })}>正式开始 Major</Button>}
    </div>
  </Panel>;
}

function Cohort({ label, range, count }: { label: string; range: string; count: number }) {
  return <div className="border border-[var(--color-border)] p-3"><p className="font-medium text-[var(--color-fg)]">{label}</p><p className="mt-1 text-sm text-[var(--color-fg-mid)]">{range} · {count} 支队伍</p></div>;
}
