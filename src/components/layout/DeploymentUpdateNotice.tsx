"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { InlineConfirm } from "@/components/rivalhub/InlineConfirm";
import { Button } from "@/components/ui/button";
import { useDeploymentUpdate } from "@/lib/deployment-update";

export function DeploymentUpdateNotice() {
  const required = useDeploymentUpdate();
  const pathname = usePathname();
  const [confirming, setConfirming] = useState(false);
  if (!required || pathname === "/login") return null;
  return <aside role="status" className="border-b border-[var(--color-border)] px-4 py-3 text-sm">
    {confirming ? <InlineConfirm title="更新页面？" sub="未保存内容会丢失。" confirmLabel="确认更新" onCancel={() => setConfirming(false)} onConfirm={() => window.location.reload()} /> :
      <div className="flex flex-wrap items-center gap-3"><span>页面版本已更新，自动更新已暂停。</span><Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)}>更新页面</Button></div>}
  </aside>;
}
