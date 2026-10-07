import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import React from "react";
import { PosChip } from "@/components/rivalhub/PosChip";
import { positionLabel } from "@/lib/validators/registration";
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
  entryAId?: string;
  entryBId?: string;
  teamAName: string;
  teamARoster: RosterPlayer[] | null;
  teamBName: string;
  teamBRoster: RosterPlayer[] | null;
}

function RosterColumn({ teamName, roster, entryId }: { entryId?: string; teamName: string; roster: RosterPlayer[] | null }) {
  const starters = roster?.filter((p) => p.isStarter) ?? [];
  const subs = roster?.filter((p) => !p.isStarter) ?? [];

  return (
    <div>
      <div
        className="mb-3 text-sm font-semibold"
        style={{ color: "var(--color-fg-mid)" }}
      >
        <TeamProfileLink entryId={entryId}>{teamName}</TeamProfileLink>
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
                <PlayerProfileLink userId={p.userId} className="flex max-w-full min-w-0 items-center gap-2 hover:text-[var(--color-accent)] transition-colors">
                  <PlayerAvatar name={getPublicDisplayName(p)} avatarUrl={p.avatarUrl} size="sm" />
                  <span className="truncate">{getPublicDisplayName(p)}</span>
                </PlayerProfileLink>
              ) : (
                <span className="flex max-w-full min-w-0 items-center gap-2">
                  <PlayerAvatar name={getPublicDisplayName(p)} avatarUrl={p.avatarUrl} size="sm" />
                  <span className="truncate">{getPublicDisplayName(p)}</span>
                </span>
              )}
              {p.registrationPosition && CS2_POSITION_LABELS[p.registrationPosition as Cs2Position] && <PosChip pos={positionLabel(p.registrationPosition)} small />}
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
                    <PlayerProfileLink userId={p.userId} className="hover:text-[var(--color-accent)] transition-colors">
                      <PlayerAvatar name={getPublicDisplayName(p)} avatarUrl={p.avatarUrl} size="sm" />
                      <span className="truncate">{getPublicDisplayName(p)}</span>
                    </PlayerProfileLink>
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
  entryAId, entryBId,
  teamAName,
  teamARoster,
  teamBName,
  teamBRoster,
}: MatchRosterViewProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <RosterColumn entryId={entryAId} teamName={teamAName} roster={teamARoster} />
      <RosterColumn entryId={entryBId} teamName={teamBName} roster={teamBRoster} />
    </div>
  );
}
