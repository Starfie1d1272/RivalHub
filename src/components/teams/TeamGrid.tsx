"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { POSITION_LABELS } from "@/lib/validators/registration";

export interface TeamCardData {
  id: string;
  name: string;
  draftOrder: number;
  captainSteamName: string | null;
  members: {
    steamName: string | null;
    primaryPosition: string;
    isStarter: boolean;
  }[];
}

interface TeamGridProps {
  teams: TeamCardData[];
  seasonSlug: string;
}

export function TeamGrid({ teams, seasonSlug }: TeamGridProps) {
  if (teams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="text-4xl mb-4">🏆</div>
        <p className="text-[var(--text-secondary)]">暂无队伍数据</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {teams.map((team) => {
        const starters = team.members.filter((m) => m.isStarter);
        return (
          <Link key={team.id} href={`/${seasonSlug}/teams/${team.id}`}>
            <Card className="p-5 bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-[var(--season-primary)] transition-colors cursor-pointer h-full">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-xs text-[var(--text-muted)] mb-0.5">
                    选秀顺序 #{team.draftOrder}
                  </p>
                  <h3 className="font-bold text-lg text-[var(--text-primary)]">{team.name}</h3>
                </div>
              </div>

              <p className="text-sm text-[var(--text-secondary)] mb-3">
                队长：{team.captainSteamName ?? "—"}
              </p>

              <div className="flex flex-wrap gap-1">
                {starters.map((m, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="text-xs border-[var(--border)] text-[var(--text-secondary)]"
                  >
                    {POSITION_LABELS[m.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? m.primaryPosition}
                  </Badge>
                ))}
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
