"use client";

import React, { useState, useTransition } from "react";
import { claimMatchCommentary } from "@/actions/postmatch";
import { Button } from "@/components/ui/button";

export function ClaimMatchButton({ matchId }: { matchId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);

  return (
    <div className="space-y-1">
      <Button type="button" size="sm" variant="outline" disabled={pending || claimed} onClick={() => {
        setError(null);
        startTransition(async () => {
          try {
            const result = await claimMatchCommentary({ matchId });
            if (result.success) setClaimed(true);
            else setError(result.error.message);
          } catch {
            setError("认领未完成，请重试。");
          }
        });
      }}>
        {pending ? "正在认领…" : claimed ? "你已认领解说" : "认领本场解说"}
      </Button>
      {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
