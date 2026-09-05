"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Panel } from "@/components/rivalhub";

export function TeamDangerZone({ pending, onDisband }: { pending: boolean; onDisband: () => void }) {
  return <Panel label="解散队伍" contentClassName="p-5"><div className="flex flex-wrap items-center justify-between gap-4"><p className="text-sm text-[var(--color-fg-mid)]">有正在进行的赛事时暂不能解散。已结束赛事的记录会保留。</p><AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="outline" disabled={pending}>解散队伍</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确定解散这支队伍？</AlertDialogTitle><AlertDialogDescription>已结束赛事的记录会保留；有正在进行的赛事时，系统会拒绝此操作。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onDisband}>确认解散</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></Panel>;
}
