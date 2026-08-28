import Link from "next/link";
import { getPublicDisplayName } from "@/lib/utils/display-name";

interface RosterPlayer {
  steamName: string;
  displayName: string | null;
  perfectName: string | null;
  primaryPosition: string;
  isStarter: boolean;
  userId?: string | null;
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
        className="mb-2 text-xs font-bold uppercase"
        style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.12em", color: "var(--color-fg-dim)" }}
      >
        {teamName}
      </div>
      {roster && roster.length > 0 ? (
        <div className="space-y-1">
          {starters.map((p, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-sm"
              style={{ color: "var(--color-fg)" }}
            >
              {p.userId ? (
                <Link href={`/players/${p.userId}`} className="hover:text-[var(--color-accent)] transition-colors">
                  {getPublicDisplayName(p)}
                </Link>
              ) : (
                <span>{getPublicDisplayName(p)}</span>
              )}
              <span
                className="text-xs"
                style={{ fontFamily: "var(--font-mono)", color: "var(--color-fg-dim)", letterSpacing: "0.06em" }}
              >
                {p.primaryPosition}
              </span>
            </div>
          ))}
          {subs.length > 0 && (
            <div
              className="pt-1 mt-1 text-xs"
              style={{ borderTop: "1px solid var(--color-border)", color: "var(--color-fg-mid)" }}
            >
              替补：{subs.map((p, i) => (
                <span key={i}>
                  {i > 0 && "、"}
                  {p.userId ? (
                    <Link href={`/players/${p.userId}`} className="hover:text-[var(--color-accent)] transition-colors">
                      {getPublicDisplayName(p)}
                    </Link>
                  ) : (
                    <>{getPublicDisplayName(p)}</>
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
