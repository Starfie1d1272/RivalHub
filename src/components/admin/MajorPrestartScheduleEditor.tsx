"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveMajorPrestartSchedule } from "@/actions/major-prestart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toCSTDateTimeInput } from "@/lib/utils/date";

export function MajorPrestartScheduleEditor({ seasonId, kind, label, value, disabled, hint }: {
  seasonId: string;
  kind: "registration-close" | "final-roster-close" | "main-event-start";
  label: string;
  value: string | null;
  disabled?: boolean;
  hint: string;
}) {
  const initial = value ? toCSTDateTimeInput(new Date(value)) ?? "" : "";
  const [draft, setDraft] = useState(initial);
  const [pending, startTransition] = useTransition();
  return <div className="flex flex-wrap items-end gap-3">
    <div className="min-w-60 space-y-1">
      <Label htmlFor={`major-time-${kind}`}>{label}</Label>
      <Input id={`major-time-${kind}`} type="datetime-local" value={draft} disabled={disabled || pending} onChange={(event) => setDraft(event.target.value)} />
      <p className="text-xs text-[var(--color-fg-mid)]">{hint}</p>
    </div>
    <Button type="button" variant="outline" disabled={disabled || pending || draft === initial} onClick={() => startTransition(async () => {
      const result = await saveMajorPrestartSchedule({ seasonId, kind, value: draft || null });
      if (!result.success) toast.error(result.error.message); else toast.success("赛前计划已保存");
    })}>保存时间</Button>
  </div>;
}
