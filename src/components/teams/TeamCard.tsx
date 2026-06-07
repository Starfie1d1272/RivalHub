import React from "react";
import Link from "next/link";
import Image from "next/image";
import { Panel, PosChip } from "@/components/rivalhub";
import { positionLabel } from "@/lib/validators/registration";

interface PlayerPreview {
  name: string;
  primaryPosition: string;
  isStarter: boolean;
  isCaptain: boolean;
  userId?: string | null;
}

interface TeamCardProps {
  teamId: string;
  teamName: string;
  seasonSlug: string;
  draftOrder: number;
  logoUrl?: string | null;
  players: PlayerPreview[];
  record?: {
    played: number;
    wins: number;
    losses: number;
    winRate: string;
  };
  summary?: {
    maps: number;
    avgRating: number;
    avgAdr: number;
  } | null;
}

function SummaryStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 border border-[var(--color-border)] bg-[var(--color-panel-low)] px-2.5 py-2">
      <p className="text-[10px] uppercase text-[var(--color-fg-dim)]" style={{ fontFamily: "var(--font-mono)" }}>
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-bold text-[var(--color-fg)] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
        {value}
      </p>
    </div>
  );
}

export function TeamCard({
  teamId,
  teamName,
  seasonSlug,
  draftOrder,
  logoUrl,
  players,
  record,
  summary,
}: TeamCardProps) {
  const starters = players.filter((p) => p.isStarter);
  const subs = players.filter((p) => !p.isStarter);
  const captain = players.find((p) => p.isCaptain);
  const initial = teamName.trim()[0]?.toUpperCase() ?? "?";

  return (
    <Panel className="h-full hover:border-[var(--color-border-hi)] transition-colors">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <Link href={`/${seasonSlug}/teams/${teamId}`} className="group flex min-w-0 items-center gap-3">
            <div className="relative w-10 h-10 rounded-md overflow-hidden shrink-0 border border-[var(--color-border)] bg-[var(--color-panel-low)] flex items-center justify-center">
              {logoUrl ? (
                <Image src={logoUrl} alt={`${teamName} logo`} fill className="object-cover" />
              ) : (
                <span className="text-sm font-bold text-[var(--color-fg-dim)]">{initial}</span>
              )}
            </div>
            <div className="min-w-0">
              <span className="text-xs text-[var(--color-fg-mid)]">Draft #{draftOrder}</span>
              <h3 className="font-bold text-lg text-[var(--color-fg)] leading-tight break-words group-hover:text-[var(--color-accent)] transition-colors">
                {teamName}
              </h3>
            </div>
          </Link>

          {record && (
            <div className="shrink-0 text-right">
              <p className="text-base font-black text-[var(--color-fg)] tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
                {record.wins}-{record.losses}
              </p>
              <p className="text-[10px] uppercase text-[var(--color-fg-mid)]" style={{ fontFamily: "var(--font-mono)" }}>
                {record.played > 0 ? `${record.winRate} WR` : "No results"}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-fg-mid)]">
          <span>
            Captain <span className="font-medium text-[var(--color-fg)]">{captain?.name ?? "TBD"}</span>
          </span>
          <span>{starters.length} starters</span>
          {subs.length > 0 && <span>{subs.length} subs</span>}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <SummaryStat label="Maps" value={summary?.maps ?? "—"} />
          <SummaryStat label="Rating" value={summary ? summary.avgRating.toFixed(2) : "—"} />
          <SummaryStat label="ADR" value={summary ? summary.avgAdr.toFixed(1) : "—"} />
        </div>

        <div className="space-y-1.5 border-t border-[var(--color-border)] pt-3">
          {starters.map((p) => (
            <div key={p.name} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {p.isCaptain && <PosChip pos="C" small />}
                {p.userId ? (
                  <Link href={`/players/${p.userId}`} className="text-sm text-[var(--color-fg)] hover:text-[var(--color-accent)] transition-colors truncate">
                    {p.name}
                  </Link>
                ) : (
                  <span className="text-sm text-[var(--color-fg)] truncate">{p.name}</span>
                )}
              </div>
              <PosChip pos={positionLabel(p.primaryPosition)} small />
            </div>
          ))}
        </div>

        {subs.length > 0 && (
          <div className="border-t border-[var(--color-border)] pt-2 flex flex-wrap gap-x-3 gap-y-1 opacity-70">
            {subs.map((p) => (
              <span key={p.name} className="inline-flex items-center gap-1 text-xs text-[var(--color-fg-mid)]">
                {p.userId ? (
                  <Link href={`/players/${p.userId}`} className="hover:text-[var(--color-accent)] transition-colors">
                    {p.name}
                  </Link>
                ) : (
                  p.name
                )}
                <span className="text-[10px] uppercase text-[var(--color-fg-dim)]">Sub</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
