"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createMatch } from "@/actions/matches";
import { Plus } from "lucide-react";

interface Team {
  id: string;
  name: string;
}

interface StageOption {
  key: string;
  name: string;
}

interface CreateMatchFormProps {
  seasonId: string;
  teams: Team[];
  stages: StageOption[];
}

export function CreateMatchForm({ seasonId, teams, stages }: CreateMatchFormProps) {
  const [open, setOpen] = useState(false);
  const [teamAId, setTeamAId] = useState("");
  const [teamBId, setTeamBId] = useState("");
  const [stage, setStage] = useState(stages[0]?.key ?? "");
  const [format, setFormat] = useState<"bo1" | "bo3" | "bo5">("bo1");
  const [isPending, startTransition] = useTransition();

  const canSubmit = teamAId && teamBId && teamAId !== teamBId && stage && format;

  function handleSubmit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await createMatch(seasonId, teamAId, teamBId, stage, format);
      if (result.success) {
        toast.success("比赛创建成功");
        setOpen(false);
        setTeamAId("");
        setTeamBId("");
      } else {
        toast.error(result.error?.message ?? "创建失败");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus size={14} className="mr-1.5" />
          新增比赛
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增比赛</DialogTitle>
          <DialogDescription>手动创建一场比赛，不关联 Bracket 节点。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-fg-mid)]">队伍 A</label>
            <Select value={teamAId} onValueChange={setTeamAId}>
              <SelectTrigger>
                <SelectValue placeholder="选择队伍" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-fg-mid)]">队伍 B</label>
            <Select value={teamBId} onValueChange={setTeamBId}>
              <SelectTrigger>
                <SelectValue placeholder="选择队伍" />
              </SelectTrigger>
              <SelectContent>
                {teams.filter((t) => t.id !== teamAId).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-fg-mid)]">阶段</label>
            <Select value={stage} onValueChange={setStage}>
              <SelectTrigger>
                <SelectValue placeholder="选择阶段" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-fg-mid)]">赛制</label>
            <Select value={format} onValueChange={(v) => setFormat(v as "bo1" | "bo3" | "bo5")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bo1">BO1</SelectItem>
                <SelectItem value="bo3">BO3</SelectItem>
                <SelectItem value="bo5">BO5</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {teamAId && teamBId && teamAId === teamBId && (
            <p className="text-xs text-[var(--color-danger)]">双方队伍不能相同</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || isPending}>
            {isPending ? "创建中..." : "创建比赛"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
