import React from "react";
import Link from "next/link";
import { Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";
export function SeasonNextStep({ task }: { task: { title: string; detail: string; href: string } | null }) {
  if (!task) return null;
  return <Panel label="与你相关" contentClassName="flex flex-wrap items-center justify-between gap-4 p-4">
    <div className="min-w-0 flex-1 basis-48"><h2 className="font-semibold">{task.title}</h2><p className="mt-1 text-sm text-[var(--color-fg-mid)]">{task.detail}</p></div>
    <Button asChild><Link href={task.href as never}>{task.title} →</Link></Button>
  </Panel>;
}
