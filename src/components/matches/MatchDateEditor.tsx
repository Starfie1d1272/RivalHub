"use client";

import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseCSTInput } from "@/lib/utils/date";
import type { ActionResult } from "@/types/action";

interface MatchDateEditorProps {
  label: string;
  initialValue: string | null;
  help?: string;
  update: (input: { value: string | null; date: Date | null }) => Promise<ActionResult<void>>;
}

/** Each date has its own saved value and mutation feedback. */
export function MatchDateEditor({ label, initialValue, help, update }: MatchDateEditorProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const initial = initialValue ?? "";
  const [field, setField] = useState({ initial, saved: initial, value: initial });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (field.initial !== initial) {
    setField({ initial, saved: initial, value: initial });
  }

  function save(value: string | null) {
    if (pending) return;
    const date = parseCSTInput(value);
    if (value && !date) {
      setError("请输入有效的北京时间。");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await update({ value, date });
        if (!result.success) {
          setError(result.error.message);
          return;
        }
        const saved = value ?? "";
        setField({ initial, saved, value: saved });
        toast.success(`${label}已${value ? "保存" : "清除"}`);
        if (!value) requestAnimationFrame(() => inputRef.current?.focus());
      } catch {
        setError("未能确认操作结果，请刷新后核对当前时间。");
      }
    });
  }

  const describedBy = [help ? `${id}-help` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id} className="text-sm">
        {label}（北京时间）
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          ref={inputRef}
          type="datetime-local"
          value={field.value}
          onChange={(event) => {
            setField({ ...field, value: event.target.value });
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className="w-full min-w-0 max-w-full sm:w-52"
          disabled={pending}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => save(field.value)}
          disabled={pending || !field.value || field.value === field.saved}
        >
          保存{label}
        </Button>
        {field.saved && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => save(null)}
            disabled={pending}
          >
            清除{label}
          </Button>
        )}
      </div>
      {help && (
        <p id={`${id}-help`} className="text-sm text-[var(--color-fg-secondary)]">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
