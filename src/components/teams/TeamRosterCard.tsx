"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const POSITION_LABELS: Record<string, { cn: string; en: string }> = {
  igl:    { cn: "指挥",        en: "IGL" },
  awper:  { cn: "狙击手",      en: "AWPer" },
  opener: { cn: "突破手",      en: "Opener" },
  closer: { cn: "自由人/残局", en: "Closer" },
  anchor: { cn: "主防",        en: "Anchor" },
};

export interface RosterMember {
  id: string;
  steamName: string | null;
  primaryPosition: string;
  peakRank: string;
  currentRating: number;
  isStarter: boolean;
  isCaptain: boolean;
}

interface TeamRosterCardProps {
  teamName: string;
  draftOrder: number;
  seasonSlug: string;
  members: RosterMember[];
}

export function TeamRosterCard({ teamName, draftOrder, seasonSlug, members }: TeamRosterCardProps) {
  const starters = members.filter((m) => m.isStarter);
  const subs = members.filter((m) => !m.isStarter);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/${seasonSlug}/teams`}
          className="text-sm text-[var(--color-fg-mid)] hover:text-[var(--color-fg)] transition-colors"
        >
          ← 所有队伍
        </Link>
      </div>

      <div>
        <p className="text-sm text-[var(--color-fg-dim)] mb-1">选秀顺序 #{draftOrder}</p>
        <h1 className="text-3xl font-bold text-[var(--color-fg)]">{teamName}</h1>
      </div>

      <Card className="bg-[var(--color-panel)] border-[var(--color-border)] overflow-hidden">
        <div className="p-4 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-fg-mid)] uppercase tracking-wide">
            首发阵容
          </h2>
        </div>
        <div className="divide-y divide-[var(--color-border)]">
          {starters.map((m) => (
            <MemberRow key={m.id} member={m} />
          ))}
        </div>
      </Card>

      {subs.length > 0 && (
        <Card className="bg-[var(--color-panel)] border-[var(--color-border)] overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)]">
            <h2 className="text-sm font-semibold text-[var(--color-fg-mid)] uppercase tracking-wide">
              替补
            </h2>
          </div>
          <div className="divide-y divide-[var(--color-border)]">
            {subs.map((m) => (
              <MemberRow key={m.id} member={m} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function MemberRow({ member }: { member: RosterMember }) {
  const posLabel = POSITION_LABELS[member.primaryPosition];

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="w-24 shrink-0">
        <Badge
          variant="outline"
          className="text-xs border-[var(--color-border)] text-[var(--color-accent)]"
        >
          {posLabel?.en ?? member.primaryPosition}
        </Badge>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[var(--color-fg)] truncate">
            {member.steamName ?? "—"}
          </span>
          {member.isCaptain && (
            <Badge className="text-xs bg-[var(--color-accent)]/10 text-[var(--color-accent)] border-[var(--color-accent)]/20 shrink-0">
              队长
            </Badge>
          )}
        </div>
        {posLabel && (
          <p className="text-xs text-[var(--color-fg-dim)]">{posLabel.cn}</p>
        )}
      </div>

      <div className="text-right shrink-0">
        <p className="text-sm font-medium text-[var(--color-fg)]">{member.peakRank}</p>
        <p className="text-xs text-[var(--color-fg-dim)]">RT {member.currentRating.toFixed(2)}</p>
      </div>
    </div>
  );
}
