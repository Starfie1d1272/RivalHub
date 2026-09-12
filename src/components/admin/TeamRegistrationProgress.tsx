import React from "react";
import { MiniStat, Panel, StatusBanner } from "@/components/rivalhub";
import { formatCST } from "@/lib/utils/date";
import type { TeamRegistrationProgressResult } from "@/lib/registrations/admin-review-contract";

export function TeamRegistrationProgress({ progress }: { progress: TeamRegistrationProgressResult }) {
  const { drafts, summary } = progress;
  return (
    <section aria-labelledby="team-registration-progress-title" className="space-y-4">
      <Panel label="报名进度" contentClassName="p-5">
        <div className="space-y-4">
          <h2 id="team-registration-progress-title" className="sr-only">组队报名运营进度</h2>
          <div className="grid gap-2 sm:grid-cols-4">
            <MiniStat label="草稿" value={summary.draft} accent />
            <MiniStat label="待审核" value={summary.submitted} />
            <MiniStat label="已通过" value={summary.approved} />
            <MiniStat label="需补正" value={summary.changesRequested} />
          </div>
          <p className="text-xs text-[var(--color-fg-mid)]">共 {summary.total} 支队伍开始报名；草稿仅用于运营观察，不进入审核队列。</p>
        </div>
      </Panel>

      {summary.total === 0 ? (
        <StatusBanner tone="info" title="暂无队伍开始报名" sub="队伍创建本届参赛报名后，运营进度会显示在这里。" />
      ) : drafts.length === 0 ? (
        <StatusBanner tone="info" title="当前没有进行中的报名草稿" sub="已开始的队伍报名均已进入其它状态。" />
      ) : (
        <Panel label="报名草稿 · 进行中的报名" contentClassName="p-0">
          {summary.submitted === 0 && (
            <div className="border-b border-[var(--color-border)] p-4">
              <StatusBanner tone="info" title={`已有 ${summary.draft} 支队伍正在填写报名`} sub="暂时还没有队伍提交审核。" />
            </div>
          )}
          <div className="divide-y divide-[var(--color-border)]">
            {drafts.map((draft) => (
              <article key={draft.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(6rem,auto))_minmax(0,1.5fr)] lg:items-center">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{draft.name}</h3>
                  <p className="mt-1 text-xs text-[var(--color-fg-mid)]">负责人：{draft.representativeName} · {draft.source === "linked_team" ? "队伍报名" : "赛事组队"}</p>
                  <p className="mt-1 text-xs text-[var(--color-fg-dim)]">最后更新：{formatCST(draft.updatedAt)}</p>
                </div>
                <ProgressFact label="名单" value={`${draft.rosterCount}/${draft.minRoster}–${draft.maxRoster}`} />
                <ProgressFact label="成员确认" value={`${draft.confirmedCount}/${draft.rosterCount}`} />
                <ProgressFact label="预定主力" value={`${draft.starterCount}/${draft.requiredStarterCount}`} />
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-dim)]">主要待办</p>
                  <p className="mt-1 text-sm text-[var(--color-fg-mid)]">{draft.primaryBlockers.length > 0 ? draft.primaryBlockers.join("；") : "暂无明显待办"}</p>
                </div>
              </article>
            ))}
          </div>
        </Panel>
      )}
    </section>
  );
}

function ProgressFact({ label, value }: { label: string; value: string }) {
  return <div><p className="font-mono text-[10px] uppercase tracking-[var(--tracking-label)] text-[var(--color-fg-dim)]">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}
