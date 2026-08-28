"use client";

import React, { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Checklist, type ChecklistItem, Panel, StatusBanner } from "@/components/rivalhub";

export interface PreMatchTeamState { name: string; submitted: boolean; confirmed: boolean; starters: number; preflight: { valid: boolean; blockers: string[] } | null; }

export function PreMatchOperatorChecklist({ teamA, teamB, mapState, requiresPreflight = false }: { teamA: PreMatchTeamState; teamB: PreMatchTeamState; mapState: "not_recorded" | "recorded" | "not_required"; requiresPreflight?: boolean }) {
  const [manual, setManual] = useState({ room: false, server: false, bp: false, ready: false });
  const teamItems = (team: PreMatchTeamState): ChecklistItem[] => [
    { label: `${team.name} · 首发名单`, state: team.submitted ? "complete" : "blocked", detail: team.submitted ? "名单已提交。" : "尚未提交首发名单。" },
    { label: `${team.name} · 恰好 5 名首发`, state: team.starters === 5 ? "complete" : "blocked", detail: `当前 ${team.starters} 名首发。` },
    { label: `${team.name} · 正式确认`, state: team.confirmed ? "complete" : "blocked", detail: team.confirmed ? "队伍首发已确认。" : "首发仍未确认。" },
    { label: `${team.name} · 赛事资格复核`, state: !requiresPreflight || team.preflight?.valid ? "complete" : "blocked", detail: !requiresPreflight ? "本场按常规赛务流程进行，无需额外资格检查。" : team.preflight?.valid ? "赛事名单、南京大学首发、成员实力、纪律与身份均已通过检查。" : team.preflight?.blockers.join(" ") ?? "先提交并确认合规首发后才能检查。" },
  ];
  const manualItems: Array<{ key: keyof typeof manual; label: string; detail: string }> = [
    { key: "room", label: "Perfect 房间已创建", detail: "请在完美平台完成创建并通知双方。" },
    { key: "server", label: "服务器与裁判已就绪", detail: "确认比赛服务器、裁判安排和通讯渠道。" },
    { key: "bp", label: "地图 BP 已处理", detail: mapState === "recorded" ? "RivalHub 中已记录地图信息；请核对双方执行结果。" : mapState === "not_required" ? "本场无需额外地图 BP。" : "需要时通过地图 BP 录入操作记录。" },
    { key: "ready", label: "双方已 ready", detail: "人工确认双方选手和裁判可以开始。" },
  ];
  const rosterBlockers = [teamA, teamB].flatMap((team) => !team.submitted ? [`${team.name} 尚未提交首发`] : team.starters !== 5 ? [`${team.name} 当前不是 5 名首发`] : !team.confirmed ? [`${team.name} 首发尚未确认`] : requiresPreflight && !team.preflight?.valid ? team.preflight?.blockers.map((blocker) => `${team.name}：${blocker}`) ?? [`${team.name} 尚未完成首发资格检查`] : []);
  return <Panel label="赛前操作检查" pad={0} className="overflow-hidden"><div className="grid divide-y divide-[var(--color-border)] lg:grid-cols-2 lg:divide-x lg:divide-y-0"><div className="p-3"><p className="mb-2 font-mono text-[11px] tracking-[0.12em] text-[var(--color-fg-mid)]">双方正式首发</p><Checklist items={[...teamItems(teamA), ...teamItems(teamB)]} /></div><div className="p-3"><p className="mb-2 font-mono text-[11px] tracking-[0.12em] text-[var(--color-fg-mid)]">人工赛务确认</p><div className="space-y-2">{manualItems.map((item) => <label key={item.key} className="flex gap-3 border border-[var(--color-border)] p-3"><Checkbox checked={manual[item.key]} onChange={(event) => setManual((current) => ({ ...current, [item.key]: event.target.checked }))} /><span><span className="block text-sm font-medium">{item.label}</span><span className="mt-1 block font-mono text-[11px] leading-5 text-[var(--color-fg-mid)]">{item.detail}</span></span></label>)}</div></div></div>{rosterBlockers.length > 0 ? <StatusBanner tone="warn" title="当前不可开赛" sub={rosterBlockers.join("；")} /> : <StatusBanner tone="info" title="可以开始比赛" sub="开始前会再次检查双方首发；人工项目供裁判逐项确认。" />}</Panel>;
}
