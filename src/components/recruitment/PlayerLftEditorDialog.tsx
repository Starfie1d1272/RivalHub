"use client";

import React from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { closePlayerLft, savePlayerLft } from "@/actions/recruitment";
import { RecruitmentPositionPicker } from "@/components/recruitment/RecruitmentPositionPicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Cs2Position } from "@/lib/config/cs2-positions";

type ExistingLft = { positions: Cs2Position[]; targetSeasonId: string | null; note: string | null } | null;

export function PlayerLftEditorDialog({ targetSeasons, existing, label = "发布找队" }: { targetSeasons: Array<{ id: string; name: string }>; existing: ExistingLft; label?: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [positions, setPositions] = useState<Cs2Position[]>(existing?.positions ?? []);
  const [targetSeasonId, setTargetSeasonId] = useState(existing?.targetSeasonId && targetSeasons.some((season) => season.id === existing.targetSeasonId) ? existing.targetSeasonId : "");
  const [note, setNote] = useState(existing?.note ?? "");
  function save() {
    startTransition(async () => {
      const result = await savePlayerLft({ positions, targetSeasonId: targetSeasonId || null, note });
      if (result.success) { toast.success("找队信息已公开，最长 30 天有效"); setOpen(false); router.refresh(); }
      else toast.error(result.error.message);
    });
  }
  function close() {
    startTransition(async () => {
      const result = await closePlayerLft();
      if (result.success) { toast.success("已关闭找队信息"); setOpen(false); router.refresh(); }
      else toast.error(result.error.message);
    });
  }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant={existing ? "outline" : "default"}>{existing ? "编辑找队" : label}</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>{existing ? "编辑找队" : "发布找队"}</DialogTitle><DialogDescription>公开当前愿意承担的位置与目标赛事；长期竞技档案仍由个人主页维护。</DialogDescription></DialogHeader><DialogBody className="space-y-5"><RecruitmentPositionPicker value={positions} onChange={setPositions} min={1} max={3} label="本次可接受位置（1-3 个）" /><div className="space-y-1.5"><Label htmlFor="lft-target-season">目标赛事</Label><select id="lft-target-season" value={targetSeasonId} onChange={(event) => setTargetSeasonId(event.target.value)} className="h-10 w-full border border-[var(--color-border)] bg-[var(--color-panel)] px-3 text-sm"><option value="">不限赛事</option>{targetSeasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}</select></div><div className="space-y-1.5"><Label htmlFor="lft-note">找队说明</Label><Textarea id="lft-note" value={note} maxLength={280} onChange={(event) => setNote(event.target.value)} placeholder="例如：希望找一支能稳定训练的长期队伍。" /></div></DialogBody><DialogFooter>{existing && <Button type="button" variant="outline" disabled={pending} onClick={close}>关闭找队</Button>}<Button type="button" disabled={pending || positions.length === 0} onClick={save}>{pending ? "保存中…" : "发布找队"}</Button></DialogFooter></DialogContent></Dialog>;
}
