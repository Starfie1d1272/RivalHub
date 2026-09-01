"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { closeTeamRecruitment, dismissRecruitmentInterest, saveTeamRecruitment } from "@/actions/recruitment";
import { InviteRecruitingPlayerButton } from "@/components/recruitment/InviteRecruitingPlayerButton";
import { RecruitmentPositionPicker } from "@/components/recruitment/RecruitmentPositionPicker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Panel, PosChip, StatusBanner, StatusPill } from "@/components/rivalhub";
import type { Cs2Position } from "@/lib/config/cs2-positions";

type Recruitment = { id: string; positions: Cs2Position[]; targetSeasonId: string | null; targetSeasonName: string | null; note: string | null; status: "open" | "closed"; expiresAt: string } | null;
type Interest = { userId: string; name: string; positions: Cs2Position[] };

export function TeamRecruitmentSection({ team, isCaptain, recruitment, targetSeasons, interests }: { team: { id: string; slug: string }; isCaptain: boolean; recruitment: Recruitment; targetSeasons: Array<{ id: string; name: string }>; interests: Interest[] }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [positions, setPositions] = useState<Cs2Position[]>(recruitment?.positions ?? []);
  const [targetSeasonId, setTargetSeasonId] = useState(recruitment?.targetSeasonId ?? "");
  const [note, setNote] = useState(recruitment?.note ?? "");
  const isOpen = recruitment?.status === "open" && new Date(recruitment.expiresAt) > new Date();
  function save() {
    startTransition(async () => {
      const result = await saveTeamRecruitment({ teamId: team.id, positions, targetSeasonId: targetSeasonId || null, note });
      if (result.success) { toast.success("队伍招募已公开，30 天内有效"); router.refresh(); }
      else toast.error(result.error.message);
    });
  }
  function close() {
    startTransition(async () => {
      const result = await closeTeamRecruitment({ teamId: team.id });
      if (result.success) { toast.success("已关闭队伍招募"); router.refresh(); }
      else toast.error(result.error.message);
    });
  }
  function dismiss(userId: string) {
    if (!recruitment) return;
    startTransition(async () => {
      const result = await dismissRecruitmentInterest({ recruitmentIntentId: recruitment.id, userId });
      if (result.success) { toast.success("已忽略该加入意向"); router.refresh(); }
      else toast.error(result.error.message);
    });
  }
  if (!isCaptain) return recruitment && isOpen ? <Panel label="队伍招募" pad={20}><div className="space-y-3"><StatusPill label="招募中" tone="accent" /><div className="flex flex-wrap gap-2">{recruitment.positions.length ? recruitment.positions.map((position) => <PosChip key={position} pos={position} />) : <span className="text-sm text-[var(--color-fg-mid)]">位置不限</span>}</div>{recruitment.note && <p className="text-sm text-[var(--color-fg-mid)]">{recruitment.note}</p>}</div></Panel> : null;
  return <Panel label="队伍招募" pad={20}><div className="space-y-5">{isOpen ? <div className="flex flex-wrap items-center justify-between gap-3"><div><StatusPill label="招募中" tone="accent" /><p className="mt-2 text-sm text-[var(--color-fg-mid)]">更新或重新发布会刷新 30 天有效期，并清除之前的加入意向。</p></div><Button size="sm" variant="outline" asChild><Link href="/teams/recruitment?view=teams">在组队大厅查看</Link></Button></div> : <StatusBanner tone="info" title="当前没有公开招募信息" sub="发布后，正在找队的选手可以在组队大厅发现你的队伍。" />}<RecruitmentPositionPicker value={positions} onChange={setPositions} label="需要位置（可留空表示位置不限）" /><div className="space-y-1.5"><Label htmlFor={`team-recruitment-season-${team.id}`}>目标赛事</Label><select id={`team-recruitment-season-${team.id}`} value={targetSeasonId} onChange={(event) => setTargetSeasonId(event.target.value)} className="h-10 w-full border border-[var(--color-border)] bg-[var(--color-panel)] px-3 text-sm"><option value="">不限赛事</option>{targetSeasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}</select></div><div className="space-y-1.5"><Label htmlFor={`team-recruitment-note-${team.id}`}>招募说明</Label><Textarea id={`team-recruitment-note-${team.id}`} value={note} maxLength={280} onChange={(event) => setNote(event.target.value)} placeholder="例如：目前四人，希望补一名稳定主狙。" /></div><div className="flex flex-wrap gap-2"><Button type="button" disabled={pending} onClick={save}>{pending ? "保存中…" : isOpen ? "更新招募" : "发布招募"}</Button>{isOpen && <Button type="button" variant="outline" disabled={pending} onClick={close}>关闭招募</Button>}</div>{isOpen && <div className="space-y-3 border-t border-[var(--color-border)] pt-5"><h3 className="font-semibold">感兴趣的选手</h3>{interests.length ? <div className="space-y-3">{interests.map((interest) => <div key={interest.userId} className="flex flex-wrap items-center justify-between gap-3 border border-[var(--color-border)] p-3"><div className="space-y-1"><Link href={`/players/${interest.userId}`} className="font-medium hover:text-[var(--color-accent)]">{interest.name}</Link><div className="flex flex-wrap gap-1.5">{interest.positions.map((position) => <PosChip key={position} pos={position} small />)}</div></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><Link href={`/players/${interest.userId}`}>查看资料</Link></Button><InviteRecruitingPlayerButton teamId={team.id} userId={interest.userId} recruitmentIntentId={recruitment!.id} /><Button size="sm" variant="outline" disabled={pending} onClick={() => dismiss(interest.userId)}>忽略</Button></div></div>)}</div> : <p className="text-sm text-[var(--color-fg-mid)]">暂时还没有选手表达加入意向。</p>}</div>}</div></Panel>;
}
