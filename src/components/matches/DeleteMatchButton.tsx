"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { InlineConfirm } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
import { deleteMatch as telemetry_deleteMatch } from "@/actions/matches";
import { observeAction } from "@/lib/telemetry/client";

const deleteMatch = observeAction("matches.deleteMatch", telemetry_deleteMatch);

interface DeleteMatchButtonProps {
  matchId: string;
}

export function DeleteMatchButton({ matchId }: DeleteMatchButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function handleDelete() {
    const result = await deleteMatch(matchId);
    if (result.success) {
      setShowConfirm(false);
      toast.success("比赛已删除");
    } else {
      toast.error(result.error.message);
    }
  }

  if (!showConfirm) {
    return (
      <Button ref={triggerRef} size="sm" variant="outline" onClick={() => setShowConfirm(true)}>
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
      returnFocusRef={triggerRef}
    />
  );
}
