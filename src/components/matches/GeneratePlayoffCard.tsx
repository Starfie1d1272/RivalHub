"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { generatePlayoff } from "@/actions/matches";
import type { TeamStanding } from "@/lib/standings";

interface GeneratePlayoffCardProps {
  seasonId: string;
  standings: TeamStanding[];
}

export function GeneratePlayoffCard({ seasonId, standings }: GeneratePlayoffCardProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    startTransition(async () => {
      const result = await generatePlayoff(seasonId);
      if (result.success) {
        toast.success(`正赛已生成，共 ${result.data.matchCount} 场第一轮对阵`);
        setOpen(false);
      } else {
        toast.error(result.error.message);
        setOpen(false);
      }
    });
  }

  return (
    <Card className="p-6 border-dashed border-2 space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">排位赛已全部结束</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            可根据积分榜生成正赛第一轮对阵
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="font-bold">生成正赛</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>确认生成正赛？</DialogTitle>
              <DialogDescription className="space-y-3 pt-2">
                <span className="block">系统将按以下种子顺序生成正赛对阵：</span>
                <div className="space-y-1">
                  {standings.map((s) => (
                    <div key={s.teamId} className="flex items-center justify-between text-sm">
                      <span>
                        <span className="font-bold text-[var(--primary)] w-5 inline-block">#{s.seed}</span>
                        {" "}{s.teamName}
                      </span>
                      <span className="text-[var(--text-secondary)]">
                        {s.wins}W {s.losses}L &nbsp; 净{s.netRounds > 0 ? "+" : ""}{s.netRounds}
                      </span>
                    </div>
                  ))}
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                取消
              </Button>
              <Button onClick={handleGenerate} disabled={isPending}>
                {isPending ? "生成中…" : "确认生成"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Card>
  );
}
