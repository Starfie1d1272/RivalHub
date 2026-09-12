"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { addCommunityAwardEvidence } from "@/actions/community-awards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Candidate = { id: string; name: string };
type Match = { id: string; label: string };

/** Public evidence entry stays a small form, independent of award-card/admin UI. */
export function CommunityAwardEvidenceForm({ awardId, candidates, matches }: { awardId: string; candidates: Candidate[]; matches: Match[] }) {
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({ explanation: "", candidateUserId: "", matchId: "", videoUrl: "" });

  function submit() {
    startTransition(async () => {
      const result = await addCommunityAwardEvidence({
        awardId,
        candidateUserId: form.candidateUserId || null,
        matchId: form.matchId || null,
        explanation: form.explanation,
        videoUrl: form.videoUrl || null,
      });
      if (result.success) {
        setForm({ explanation: "", candidateUserId: "", matchId: "", videoUrl: "" });
        toast.success("候选证据已提交，等待管理员核实。");
      } else {
        toast.error(result.error?.message ?? "操作失败。");
      }
    });
  }

  return (
    <div className="grid gap-2">
      <Select value={form.candidateUserId} onValueChange={(candidateUserId) => setForm({ ...form, candidateUserId })}>
        <SelectTrigger aria-label="选择候选人"><SelectValue placeholder="候选人（选填）" /></SelectTrigger>
        <SelectContent>{candidates.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={form.matchId} onValueChange={(matchId) => setForm({ ...form, matchId })}>
        <SelectTrigger aria-label="选择相关比赛"><SelectValue placeholder="相关比赛（选填）" /></SelectTrigger>
        <SelectContent>{matches.map((match) => <SelectItem key={match.id} value={match.id}>{match.label}</SelectItem>)}</SelectContent>
      </Select>
      <Textarea aria-label="说明为什么该候选人符合条件" placeholder="说明为什么该候选人符合条件" value={form.explanation} onChange={(event) => setForm({ ...form, explanation: event.target.value })} />
      <Input aria-label="视频链接（选填）" type="url" placeholder="视频链接（选填）" value={form.videoUrl} onChange={(event) => setForm({ ...form, videoUrl: event.target.value })} />
      <Button size="sm" disabled={!form.explanation.trim() || isPending} onClick={submit}>提交证据</Button>
    </div>
  );
}
