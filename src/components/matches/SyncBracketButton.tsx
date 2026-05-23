"use client";

import { useState } from "react";
import { syncBracketMatches } from "@/actions/matches";
import { Btn } from "@/components/rivalhub";

export function SyncBracketButton({ seasonId }: { seasonId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [created, setCreated] = useState(0);

  async function handleSync() {
    setStatus("loading");
    const result = await syncBracketMatches(seasonId);
    if (result.success) {
      setCreated(result.data.created);
      setStatus("done");
    } else {
      setStatus("error");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Btn ghost onClick={handleSync} disabled={status === "loading"}>
        {status === "loading" ? "修复中…" : "修复 Bracket 缺失比赛"}
      </Btn>
      {status === "done" && (
        <span className="text-xs text-[var(--color-fg-mid)]">
          {created > 0 ? `已创建 ${created} 场` : "无缺失比赛"}
        </span>
      )}
      {status === "error" && (
        <span className="text-xs text-[var(--color-destructive)]">操作失败，请刷新重试</span>
      )}
    </div>
  );
}
