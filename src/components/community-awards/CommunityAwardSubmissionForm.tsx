"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { submitCommunityAward } from "@/actions/community-awards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** The submission workflow is shared without importing an admin/list presentation. */
export function CommunityAwardSubmissionForm({ seasonId }: { seasonId: string }) {
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({ name: "", condition: "", prize: "", supplementaryNote: "" });

  function submit() {
    startTransition(async () => {
      const result = await submitCommunityAward({ seasonId, ...form, supplementaryNote: form.supplementaryNote.trim() || null });
      if (result.success) {
        setForm({ name: "", condition: "", prize: "", supplementaryNote: "" });
        toast.success("社区奖已提交，等待赛事管理员审核。");
      } else {
        toast.error(result.error?.message ?? "操作失败。");
      }
    });
  }

  return (
    <div className="grid gap-3">
      <Input aria-label="奖项名称" placeholder="奖项名称" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      <Textarea aria-label="获奖条件：说明何时、如何判断" placeholder="获奖条件：说明何时、如何判断" value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })} />
      <Input aria-label="奖品" placeholder="奖品" value={form.prize} onChange={(event) => setForm({ ...form, prize: event.target.value })} />
      <Textarea aria-label="补充说明（选填）" placeholder="补充说明（选填）" value={form.supplementaryNote} onChange={(event) => setForm({ ...form, supplementaryNote: event.target.value })} />
      <Button disabled={!form.name.trim() || !form.condition.trim() || !form.prize.trim() || isPending} onClick={submit}>提交社区奖</Button>
    </div>
  );
}
