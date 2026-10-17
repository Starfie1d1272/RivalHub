import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export function SeasonNextStep({ task }: { task: { title: string; detail: string; href: string } | null }) {
  if (!task) return null;
  return <section aria-label="与你相关" className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] py-3">
    <div className="min-w-0 flex-1 basis-48"><h2 className="font-semibold">{task.title}</h2><p className="mt-1 text-xs text-[var(--color-fg-mid)]">{task.detail}</p></div>
    <Button size="sm" variant="outline" asChild><Link href={task.href as never}>{task.title} →</Link></Button>
  </section>;
}
