"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { runSchedulerJobManually } from "@/actions/scheduler";
import { InlineConfirm, Panel, StatusPill } from "@/components/rivalhub";
import type { SchedulerHealthView } from "@/lib/scheduler/admin";

function formatHealthTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "暂无记录";
}

export function SchedulerHealthPanel({ jobs }: { jobs: SchedulerHealthView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);

  function run(jobKey: SchedulerHealthView["jobKey"]): void {
    startTransition(async () => {
      const result = await runSchedulerJobManually({ jobKey });
      setConfirming(null);
      if (result.success) {
        toast.success("定时任务已运行。");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <div className="space-y-3">
      {jobs.map((job) => (
        <Panel key={job.jobKey} contentClassName="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-[var(--color-fg)]">{job.label}</h3>
                <StatusPill label={job.status === "normal" ? "正常" : "已降级"} tone={job.status === "normal" ? "success" : "warn"} />
              </div>
              <p className="mt-1 text-xs text-[var(--color-fg-mid)]">最近主调度唤醒：{formatHealthTime(job.primaryTriggeredAt)}</p>
            </div>
            <button type="button" className="text-sm font-medium text-[var(--color-accent)] underline-offset-4 hover:underline disabled:opacity-50" disabled={pending} onClick={() => setConfirming(job.jobKey)}>
              立即运行一次
            </button>
          </div>
          <dl className="grid gap-2 text-xs text-[var(--color-fg-mid)] sm:grid-cols-2">
            <div><dt className="inline">最近任务接口成功：</dt><dd className="inline">{formatHealthTime(job.endpointSucceededAt)}</dd></div>
            <div><dt className="inline">最近真实推进：</dt><dd className="inline">{formatHealthTime(job.businessTransitionAt)}</dd></div>
            <div><dt className="inline">最近兜底运行：</dt><dd className="inline">{formatHealthTime(job.watchdogSucceededAt)}</dd></div>
            <div><dt className="inline">最近人工运行：</dt><dd className="inline">{formatHealthTime(job.manualSucceededAt)}</dd></div>
            {job.failureAt && <div className="sm:col-span-2"><dt className="inline text-[var(--color-warn)]">最近失败：</dt><dd className="inline">{formatHealthTime(job.failureAt)}</dd></div>}
          </dl>
          {confirming === job.jobKey && <InlineConfirm title={`运行“${job.label}”？`} sub="这会立即执行该定时任务，并可能更新对应系统状态，仅用于故障恢复。" confirmLabel="确认运行" onCancel={() => setConfirming(null)} onConfirm={() => run(job.jobKey)} />}
        </Panel>
      ))}
    </div>
  );
}
