import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { POSITION_LABELS } from "@/lib/validators/registration";

interface PlayerPreview {
  name: string;
  primaryPosition: string;
  isStarter: boolean;
  isCaptain: boolean;
}

interface TeamCardProps {
  teamId: string;
  teamName: string;
  seasonSlug: string;
  draftOrder: number;
  players: PlayerPreview[];
}

export function TeamCard({ teamId, teamName, seasonSlug, draftOrder, players }: TeamCardProps) {
  const starters = players.filter((p) => p.isStarter);
  const subs = players.filter((p) => !p.isStarter);

  return (
    <Link href={`/${seasonSlug}/teams/${teamId}`}>
      <Card className="p-5 hover:bg-[var(--surface-elevated)] transition-colors cursor-pointer h-full">
        <div className="space-y-4">
          {/* 队名 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-secondary)]">#{draftOrder}</span>
            <h3 className="font-bold text-lg text-[var(--text-primary)]">{teamName}</h3>
          </div>

          {/* 首发阵容 */}
          <div className="space-y-1.5">
            {starters.map((p) => (
              <div key={p.name} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {p.isCaptain && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 text-[var(--primary)]">
                      C
                    </Badge>
                  )}
                  <span className="text-sm text-[var(--text-primary)]">{p.name}</span>
                </div>
                <span className="text-xs text-[var(--text-secondary)]">
                  {POSITION_LABELS[p.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? p.primaryPosition}
                </span>
              </div>
            ))}
          </div>

          {/* 替补 */}
          {subs.length > 0 && (
            <div className="border-t border-[var(--border)] pt-2 space-y-1">
              {subs.map((p) => (
                <div key={p.name} className="flex items-center justify-between gap-2 opacity-60">
                  <span className="text-xs text-[var(--text-secondary)]">{p.name}</span>
                  <span className="text-[10px] text-[var(--text-secondary)]">替补</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}
