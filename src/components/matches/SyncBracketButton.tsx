"use client";

import { useState } from "react";
import { syncBracketMatches } from "@/actions/matches";
import { Btn } from "@/components/rivalhub";

export function SyncBracketButton({ seasonId }: { seasonId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState({ created: 0, fixed: 0 });

  async function handleSync() {
    setStatus("loading");
    const res = await syncBracketMatches(seasonId);
    if (res.success) {
      setResult(res.data);
      setStatus("done");
    } else {
      setStatus("error");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Btn ghost onClick={handleSync} disabled={status === "loading"}>
        {status === "loading" ? "修复中…" : "修复 Bracket 比赛"}
      </Btn>
      {status === "done" && (
        <span className="text-xs text-[var(--color-fg-mid)]">
          {result.created === 0 && result.fixed === 0
            ? "无问题"
            : `创建 ${result.created} 场，修正 ${result.fixed} 场`}
        </span>
      )}
      {status === "error" && (
        <span className="text-xs text-[var(--color-destructive)]">操作失败，请刷新重试</span>
      )}
    </div>
  );
}
