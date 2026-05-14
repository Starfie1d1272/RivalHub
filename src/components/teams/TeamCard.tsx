import Link from "next/link";
import Image from "next/image";
import { Panel, PosChip } from "@/components/rivalhub";
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
  logoUrl?: string | null;
  players: PlayerPreview[];
}

export function TeamCard({ teamId, teamName, seasonSlug, draftOrder, logoUrl, players }: TeamCardProps) {
  const starters = players.filter((p) => p.isStarter);
  const subs = players.filter((p) => !p.isStarter);
  const initial = teamName.trim()[0]?.toUpperCase() ?? "?";

  return (
    <Link href={`/${seasonSlug}/teams/${teamId}`}>
      <Panel className="hover:border-[var(--color-border-hi)] transition-colors cursor-pointer h-full">
        <div className="space-y-4">
          {/* 队名 + logo */}
          <div className="flex items-center gap-3">
            {/* 小 logo：40×40 */}
            <div className="relative w-10 h-10 rounded-md overflow-hidden shrink-0 border border-[var(--color-border)] bg-[var(--color-bg-subtle)] flex items-center justify-center">
              {logoUrl ? (
                <Image src={logoUrl} alt={`${teamName} logo`} fill className="object-cover" />
              ) : (
                <span className="text-sm font-bold text-[var(--color-fg-dim)]">{initial}</span>
              )}
            </div>
            <div>
              <span className="text-xs text-[var(--color-fg-mid)]">#{draftOrder}</span>
              <h3 className="font-bold text-lg text-[var(--color-fg)] leading-tight">{teamName}</h3>
            </div>
          </div>

          {/* 首发阵容 */}
          <div className="space-y-1.5">
            {starters.map((p) => (
              <div key={p.name} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {p.isCaptain && <PosChip pos="C" small />}
                  <span className="text-sm text-[var(--color-fg)]">{p.name}</span>
                </div>
                <span className="text-xs text-[var(--color-fg-mid)]">
                  {POSITION_LABELS[p.primaryPosition as keyof typeof POSITION_LABELS]?.cn ?? p.primaryPosition}
                </span>
              </div>
            ))}
          </div>

          {/* 替补 */}
          {subs.length > 0 && (
            <div className="border-t border-[var(--color-border)] pt-2 space-y-1">
              {subs.map((p) => (
                <div key={p.name} className="flex items-center justify-between gap-2 opacity-60">
                  <span className="text-xs text-[var(--color-fg-mid)]">{p.name}</span>
                  <span className="text-[10px] text-[var(--color-fg-mid)]">替补</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </Link>
  );
}
