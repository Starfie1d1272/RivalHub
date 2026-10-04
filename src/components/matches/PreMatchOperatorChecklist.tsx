import React from "react";
import { Panel, StatusBanner } from "@/components/rivalhub";

export interface PreMatchTeamState { name: string; submitted: boolean; confirmed: boolean; starters: number; preflight: { valid: boolean; blockers: string[] } | null; }

export function PreMatchOperatorChecklist({ teamA, teamB, mapState, requiresPreflight = false }: { teamA: PreMatchTeamState; teamB: PreMatchTeamState; mapState: "not_recorded" | "recorded"; requiresPreflight?: boolean }) {
  const blockers = [teamA, teamB].flatMap(team => !team.submitted ? [`${team.name}：请提交首发`] : team.starters !== 5 ? [`${team.name}：请补齐 5 名首发（当前 ${team.starters} 人）`] : requiresPreflight && !team.preflight?.valid ? team.preflight?.blockers.map(blocker => `${team.name}：${blocker}`) ?? [`${team.name}：请完成首发资格检查`] : []);
  return <Panel label="赛前准备">
    <div className="grid gap-4 sm:grid-cols-2">{[teamA, teamB].map(team => <div key={team.name}>
      <p className="font-medium">{team.name}</p><p className="mt-1 text-sm text-[var(--color-fg-mid)]">{team.submitted ? `${team.starters} 名首发 · ${team.confirmed ? "已确认" : "开赛时核验并确认"}` : "待提交首发"}</p>
    </div>)}</div>
    <div className="mt-4"><StatusBanner tone={blockers.length ? "warn" : "info"} title={blockers.length ? "首发待处理" : "首发已准备好"} sub={blockers.length ? blockers.join("；") : mapState === "recorded" ? "BP 已完成，按地图计划创建 Perfect 房间。" : "双方进入 BP，确认准备后开始禁选。"} /></div>
  </Panel>;
}
