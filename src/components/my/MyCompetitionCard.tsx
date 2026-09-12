import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Panel, StatusPill } from "@/components/rivalhub";
import { presentSeasonStatus } from "@/lib/seasons/presentation";
import type { MyCompetitionContext } from "@/lib/my/competitions";

const ROLE_LABELS: Record<MyCompetitionContext["viewerRole"], string> = {
  representative: "赛事负责人",
  participant: "参赛成员",
  team_member: "队伍成员",
};

export function MyCompetitionCard({ context }: { context: MyCompetitionContext }) {
  const seasonStatus = presentSeasonStatus(context.season.status);
  return (
    <Panel label={context.season.name} contentClassName="p-5">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{context.entryName}</h3>
            <p className="mt-1 text-sm text-[var(--color-fg-mid)]">{ROLE_LABELS[context.viewerRole]}</p>
          </div>
          <StatusPill label={seasonStatus.label} tone={seasonStatus.tone} />
        </div>
        <div className="grid gap-3 text-sm leading-6 text-[var(--color-fg-mid)] sm:grid-cols-2">
          <p>报名：{context.registration.label} · {context.registration.detail}</p>
          {context.participation && <p>参赛确认：{context.participation.label} · {context.participation.detail}</p>}
        </div>
        {context.nextMatch && <div className="border-l-2 border-[var(--color-accent)] pl-3"><p className="font-medium">{context.nextMatch.title}</p><p className="text-sm text-[var(--color-fg-mid)]">{context.nextMatch.detail}</p></div>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="default" asChild><Link href={context.primaryAction.href as never}>{context.primaryAction.label}</Link></Button>
          {context.secondaryAction && <Button size="sm" variant="outline" asChild><Link href={context.secondaryAction.href as never}>{context.secondaryAction.label}</Link></Button>}
        </div>
      </div>
    </Panel>
  );
}
