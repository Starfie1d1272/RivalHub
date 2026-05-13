"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateTeamName } from "@/actions/teams";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface TeamNameFormProps {
  teamId: string;
  initialName: string;
}

export function TeamNameForm({ teamId, initialName }: TeamNameFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [isPending, startTransition] = useTransition();
  const trimmedName = name.trim();
  const canSubmit =
    trimmedName.length >= 2 &&
    trimmedName.length <= 32 &&
    trimmedName !== savedName;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    startTransition(async () => {
      const result = await updateTeamName(teamId, trimmedName);
      if (result.success) {
        setSavedName(trimmedName);
        setName(trimmedName);
        router.refresh();
        toast.success("队伍名称已更新");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        minLength={2}
        maxLength={32}
        aria-label="队伍名称"
      />
      <Button type="submit" size="sm" disabled={!canSubmit || isPending}>
        保存
      </Button>
    </form>
  );
}
