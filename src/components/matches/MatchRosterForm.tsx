"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { submitMatchRoster } from "@/actions/matches/roster";
import { Button } from "@/components/ui/button";

interface TeamMember {
  id: string;
  steamName: string;
  primaryPosition: string;
}

interface MatchRosterFormProps {
  matchId: string;
  teamMembers: TeamMember[];
  hasExistingRoster: boolean;
}

export function MatchRosterForm({
  matchId,
  teamMembers,
  hasExistingRoster,
}: MatchRosterFormProps) {
  const [isPending, startTransition] = useTransition();
  const [selectedStarterIds, setSelectedStarterIds] = useState<string[]>([]);
  const [selectedSubstituteIds, setSelectedSubstituteIds] = useState<string[]>([]);

  const toggleStarter = (id: string) => {
    setSelectedStarterIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 5
          ? [...prev, id]
          : prev,
    );
    setSelectedSubstituteIds((prev) => prev.filter((x) => x !== id));
  };

  const toggleSubstitute = (id: string) => {
    if (selectedStarterIds.includes(id)) return;
    setSelectedSubstituteIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 2
          ? [...prev, id]
          : prev,
    );
  };

  const handleSubmit = () => {
    if (selectedStarterIds.length !== 5) {
      toast.error("请选择 5 名首发");
      return;
    }
    startTransition(async () => {
      const result = await submitMatchRoster(matchId, selectedStarterIds, selectedSubstituteIds);
      if (result.success) {
        toast.success("名单提交成功");
      } else {
        toast.error(result.error.message ?? "提交失败");
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-sm font-medium">首发</p>
        <div className="flex flex-wrap gap-2">
          {teamMembers.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => toggleStarter(m.id)}
              className={`rounded border px-3 py-1 text-sm transition ${
                selectedStarterIds.includes(m.id)
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
            >
              {m.steamName} ({m.primaryPosition})
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        已选 {selectedStarterIds.length}/5 名首发
      </p>

      <div className="space-y-2">
        <p className="text-sm font-medium">替补</p>
        <div className="flex flex-wrap gap-2">
          {teamMembers.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => toggleSubstitute(m.id)}
              disabled={selectedStarterIds.includes(m.id)}
              className={`rounded border px-3 py-1 text-sm transition ${
                selectedSubstituteIds.includes(m.id)
                  ? "bg-primary text-primary-foreground"
                  : selectedStarterIds.includes(m.id)
                    ? "cursor-not-allowed opacity-50"
                    : "hover:bg-accent"
              }`}
            >
              {m.steamName} ({m.primaryPosition})
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        已选 {selectedSubstituteIds.length}/2 名替补（可不选）
      </p>
      {!hasExistingRoster && (
        <Button
          onClick={handleSubmit}
          disabled={isPending || selectedStarterIds.length !== 5}
          size="sm"
        >
          提交名单
        </Button>
      )}
      {hasExistingRoster && (
        <p className="text-sm text-yellow-600">
          名单已锁定，联系管理员解锁后可重新提交。
        </p>
      )}
    </div>
  );
}
