"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InlineConfirm } from "@/components/rivalhub/InlineConfirm";
import { takeOverMap } from "@/actions/matches/operations";

export function ManualMapTakeover({ matchId, seasonId }: { matchId: string; seasonId: string }) {
  const [confirm, setConfirm] = useState(false);
  const [pending, transition] = useTransition();
  const router = useRouter();
  if (!confirm) return <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>人工接管当前地图</Button>;
  return <InlineConfirm title="人工接管当前地图？" sub="本图后到的制播赛果不会覆盖人工记录；下一图健康时可恢复自动处理。" danger confirmLabel={pending ? "处理中…" : "确认接管"} onCancel={() => setConfirm(false)} onConfirm={() => transition(async () => { const result = await takeOverMap(matchId, seasonId); if (!result.success) toast.error(result.error.message); else { toast.success("本图已由人工接管"); setConfirm(false); router.refresh(); } })} />;
}
