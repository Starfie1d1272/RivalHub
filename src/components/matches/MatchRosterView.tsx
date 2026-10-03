import React from "react";
import Link from "next/link";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { CS2_POSITION_LABELS, type Cs2Position } from "@/lib/config/cs2-positions";
import { getPublicDisplayName } from "@/lib/identity/display-name";

interface RosterPlayer {
  registrationPosition?: string;
  personaName: string | null;
  displayName: string | null;
  perfectName: string | null;
  isStarter: boolean;
  userId?: string | null;
  avatarUrl: string | null;
}

interface MatchRosterViewProps {
  teamAName: string;
  teamARoster: RosterPlayer[] | null;
  teamBName: string;
  teamBRoster: RosterPlayer[] | null;
}

function RosterColumn({ teamName, roster }: { teamName: string; roster: RosterPlayer[] | null }) {
  const starters = roster?.filter((p) => p.isStarter) ?? [];
  const subs = roster?.filter((p) => !p.isStarter) ?? [];

  return (
    <div>
      <div
        className="mb-3 text-sm font-semibold"
        style={{ color: "var(--color-fg-mid)" }}
      >
        {teamName}
      </div>
      {roster && roster.length > 0 ? (
        <div className="space-y-1">
          {starters.map((p, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
              style={{ color: "var(--color-fg)" }}
            >
              {p.userId ? (
                <Link href={`/players/${p.userId}`} className="flex max-w-full min-w-0 items-center gap-2 hover:text-[var(--color-accent)] transition-colors">
                  <PlayerAvatar name={getPublicDisplayName(p)} avatarUrl={p.avatarUrl} size="sm" />
                  <span className="truncate">{getPublicDisplayName(p)}</span>
                </Link>
              ) : (
                <span className="flex max-w-full min-w-0 items-center gap-2">
                  <PlayerAvatar name={getPublicDisplayName(p)} avatarUrl={p.avatarUrl} size="sm" />
                  <span className="truncate">{getPublicDisplayName(p)}</span>
                </span>
              )}
              {p.registrationPosition && CS2_POSITION_LABELS[p.registrationPosition as Cs2Position] && <span className="text-xs text-[var(--color-fg-dim)]">报名位置 · {CS2_POSITION_LABELS[p.registrationPosition as Cs2Position].cn}</span>}
            </div>
          ))}
          {subs.length > 0 && (
            <div
              className="pt-1 mt-1 text-xs"
              style={{ borderTop: "1px solid var(--color-border)", color: "var(--color-fg-mid)" }}
            >
              替补：{subs.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1 align-middle">
                  {i > 0 && "、"}
                  {p.userId ? (
                    <Link href={`/players/${p.userId}`} className="hover:text-[var(--color-accent)] transition-colors">
                      <PlayerAvatar name={getPublicDisplayName(p)} avatarUrl={p.avatarUrl} size="sm" />
                      <span className="truncate">{getPublicDisplayName(p)}</span>
                    </Link>
                  ) : (
                    <>
                      <PlayerAvatar name={getPublicDisplayName(p)} avatarUrl={p.avatarUrl} size="sm" />
                      <span className="truncate">{getPublicDisplayName(p)}</span>
                    </>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm" style={{ color: "var(--color-fg-dim)" }}>
          未提交
        </p>
      )}
    </div>
  );
}

export function MatchRosterView({
  teamAName,
  teamARoster,
  teamBName,
  teamBRoster,
}: MatchRosterViewProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <RosterColumn teamName={teamAName} roster={teamARoster} />
      <RosterColumn teamName={teamBName} roster={teamBRoster} />
    </div>
  );
}
