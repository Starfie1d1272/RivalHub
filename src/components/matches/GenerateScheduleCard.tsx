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
import { generateSchedule } from "@/actions/matches";
import { STAGE_TYPE_LABELS, type StagePlan } from "@/types/season";

interface GenerateScheduleCardProps {
  seasonId: string;
  stagePlan: StagePlan;
  teamCount: number;
}

export function GenerateScheduleCard({
  seasonId,
  stagePlan,
  teamCount,
}: GenerateScheduleCardProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    startTransition(async () => {
      const result = await generateSchedule(seasonId);
      if (result.success) {
        toast.success(`赛程已生成，共 ${result.data.matchCount} 场`);
        setOpen(false);
      } else {
        toast.error(result.error.message);
        setOpen(false);
      }
    });
  }

  const firstStage = stagePlan[0];

  return (
    <Card className="p-6 border-dashed border-2 text-center space-y-4">
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-[var(--text-primary)]">赛程尚未生成</h2>
        <p className="text-[var(--text-secondary)] text-sm">
          共 {teamCount} 支队伍参赛
          {stagePlan.map((stage) => (
            <span key={stage.key}>
              {" · "}{stage.name}：{STAGE_TYPE_LABELS[stage.type] ?? stage.type}
            </span>
          ))}
        </p>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="lg" className="font-bold">
            一键生成赛程
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认生成赛程？</DialogTitle>
            <DialogDescription className="space-y-2 pt-2">
              <span className="block">
                系统将根据赛季配置初始化第一个阶段。
              </span>
              {firstStage?.type === "round_robin" && (
                <span className="block">
                  单循环 {teamCount} 队 → 共 {(teamCount * (teamCount - 1)) / 2} 场 BO1。
                </span>
              )}
              <span className="block text-yellow-600 font-medium">
                生成后无法重置，请确认队伍名单已完整。
              </span>
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
    </Card>
  );
}
