"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createMatch } from "@/actions/matches";

interface TeamOption {
  id: string;
  name: string;
}

interface CreateMatchFormProps {
  seasonId: string;
  teams: TeamOption[];
  onSuccess: () => void;
}

export function CreateMatchForm({ seasonId, teams, onSuccess }: CreateMatchFormProps) {
  const [isPending, startTransition] = useTransition();
  const [teamAId, setTeamAId] = useState("");
  const [teamBId, setTeamBId] = useState("");
  const [stage, setStage] = useState<"qualifier" | "playoff">("qualifier");
  const [format, setFormat] = useState<"bo1" | "bo3" | "bo5">("bo3");
  const [scheduledAt, setScheduledAt] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!teamAId || !teamBId) return;
    if (teamAId === teamBId) {
      toast.error("两支队伍不能相同");
      return;
    }
    startTransition(async () => {
      const result = await createMatch({
        seasonId,
        teamAId,
        teamBId,
        stage,
        format,
        scheduledAt: scheduledAt || undefined,
      });
      if (result.success) {
        toast.success("比赛创建成功");
        onSuccess();
      } else {
        toast.error(result.error.message);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>队伍 A</Label>
          <Select value={teamAId} onValueChange={setTeamAId}>
            <SelectTrigger>
              <SelectValue placeholder="选择队伍 A" />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id} disabled={t.id === teamBId}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>队伍 B</Label>
          <Select value={teamBId} onValueChange={setTeamBId}>
            <SelectTrigger>
              <SelectValue placeholder="选择队伍 B" />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id} disabled={t.id === teamAId}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>赛段</Label>
          <Select value={stage} onValueChange={(v) => setStage(v as typeof stage)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="qualifier">排位赛</SelectItem>
              <SelectItem value="playoff">正赛</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>赛制</Label>
          <Select value={format} onValueChange={(v) => setFormat(v as typeof format)}>
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
      </div>

      <div className="space-y-1.5">
        <Label>
          预定时间 <span className="text-[var(--text-muted)]">（可选）</span>
        </Label>
        <Input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={isPending || !teamAId || !teamBId}>
          {isPending ? "创建中..." : "创建比赛"}
        </Button>
      </div>
    </form>
  );
}
