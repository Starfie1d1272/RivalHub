"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateDisplayName } from "@/actions/account";
import { Field, Btn } from "@/components/rivalhub";

interface DisplayNameFormProps {
  currentDisplayName?: string | null;
}

export function DisplayNameForm({ currentDisplayName }: DisplayNameFormProps) {
  const [displayName, setDisplayName] = useState(currentDisplayName ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    startTransition(async () => {
      const result = await updateDisplayName(displayName);
      if (result.success) {
        toast.success("昵称已更新");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {currentDisplayName && (
        <p className="text-sm text-[var(--color-fg-dim)]">
          当前昵称：<span className="text-[var(--color-fg-mid)] font-medium">{currentDisplayName}</span>
        </p>
      )}
      <Field
        id="display-name"
        label="自定义昵称"
        type="text"
        placeholder="输入自定义昵称"
        value={displayName}
        onChange={setDisplayName}
        required
        minLength={2}
        maxLength={20}
      />
      <Btn type="submit" full disabled={isPending}>
        {isPending ? "保存中…" : "保存昵称"}
      </Btn>
    </form>
  );
}
