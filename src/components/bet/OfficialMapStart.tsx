"use client";
import { useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InlineConfirm } from "@/components/rivalhub";
import { startOfficialMap } from "@/actions/bet";
export function OfficialMapStart({seasonId,matchId,mapId,mapName}:{seasonId:string;matchId:string;mapId:string;mapName:string}) {
  const [confirm,setConfirm]=useState(false);const [busy,startTransition]=useTransition();const router=useRouter();
  return confirm?<InlineConfirm title={`确认 ${mapName} 已正式开局？`} sub="记录实际开图事实，并立即锁定相关盘口。只在对局实际开始后确认。" onCancel={()=>{if(!busy)setConfirm(false);}} confirmLabel={busy?"处理中…":"确认已开局"} onConfirm={()=>{if(busy)return;startTransition(async()=>{const r=await startOfficialMap({seasonId,matchId,mapId});if(!r.success)toast.error(r.error.message);else{setConfirm(false);router.refresh();}});}}/>:<Button variant="outline" size="sm" onClick={()=>setConfirm(true)}>确认本图已开局</Button>;
}
