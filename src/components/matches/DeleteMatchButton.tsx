"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { InlineConfirm } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { deleteMatch } from "@/actions/matches";

interface DeleteMatchButtonProps {
  matchId: string;
}

export function DeleteMatchButton({ matchId }: DeleteMatchButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteMatch(matchId);
      if (result.success) {
        toast.success("比赛已删除");
      } else {
        toast.error(result.error.message);
      }
    });
  }

  if (!showConfirm) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setShowConfirm(true)}
        disabled={isPending}
      >
        删除
      </Button>
    );
  }

  return (
    <InlineConfirm
      title="确认删除比赛？"
      sub="此操作不可撤销，将同时删除地图记录、BP 数据及人员名单"
      danger
      onConfirm={handleDelete}
      onCancel={() => setShowConfirm(false)}
    />
  );
}
