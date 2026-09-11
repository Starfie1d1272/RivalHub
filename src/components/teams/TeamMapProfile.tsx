import React from "react";
import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import { MapPreferenceChips } from "@/components/rivalhub/MapPreferenceChips";
import { mapLabel } from "@/lib/maps";
import { formatStat } from "@/lib/stats";
import type { PublicTeamMapProfile } from "@/lib/teams/map-profile";

export function TeamMapProfile({ profile, event = false }: { profile: PublicTeamMapProfile; event?: boolean }) {
  return <Panel label="地图画像" contentClassName="space-y-5 p-5">
    <section className="space-y-3"><h2 className="font-semibold">{event ? "本届队伍正式表现" : "队伍正式历史表现"}</h2>
      {profile.own.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{profile.own.map((map) => <div key={map.mapName} className="border border-[var(--color-border)] p-3"><h3 className="font-semibold">{mapLabel(map.mapName)}</h3><p className="mt-1 text-sm tabular-nums">{map.wins} 胜 · {map.played - map.wins} 负</p><p className="text-xs text-[var(--color-fg-mid)]">{map.played} 图 · 胜率 {Math.round(map.wins / map.played * 100)}%</p></div>)}</div> : <p className="text-sm text-[var(--color-fg-mid)]">尚无自身正式地图样本，可先参考下方阵容经验。</p>}
    </section>
    <details open={profile.own.length === 0} className="space-y-3"><summary className="cursor-pointer font-semibold">当前阵容成员 · 历史正式地图经验</summary>
      <p className="text-xs text-[var(--color-fg-mid)]">成员在过往正式赛事中的个人表现；样本按选手出场地图计数。</p>
      {profile.experience.length ? <div className="grid gap-3 sm:grid-cols-2">{profile.experience.map((map) => <div key={map.mapName} className="text-sm"><span className="font-medium">{mapLabel(map.mapName)}</span><p className="text-xs text-[var(--color-fg-mid)]">{map.players} 位成员 · {map.samples} 人次地图 · Rating {formatStat("ratingPro", map.rating)} · ADR {formatStat("adr", map.adr)}</p></div>)}</div> : <p className="text-sm text-[var(--color-fg-mid)]">暂无成员历史正式地图数据。</p>}
    </details>
    <details className="space-y-3"><summary className="cursor-pointer font-semibold">成员自报地图熟练度</summary>{profile.preferences.length ? profile.preferences.map((member) => <div key={member.userId} className="space-y-2"><Link className="text-sm" href={`/players/${member.userId}`}>{member.name}</Link><MapPreferenceChips preferences={member.preferences} minLevel="none" /></div>) : <p className="text-sm text-[var(--color-fg-mid)]">成员尚未填写。</p>}</details>
  </Panel>;
}
