interface RosterPlayer {
  steamName: string;
  primaryPosition: string;
  isStarter: boolean;
}

interface MatchRosterViewProps {
  teamAName: string;
  teamARoster: RosterPlayer[] | null;
  teamBName: string;
  teamBRoster: RosterPlayer[] | null;
}

export function MatchRosterView({
  teamAName,
  teamARoster,
  teamBName,
  teamBRoster,
}: MatchRosterViewProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <h4 className="font-medium">{teamAName}</h4>
        {teamARoster && teamARoster.length > 0 ? (
          <ul className="mt-1 space-y-1 text-sm">
            {teamARoster
              .filter((p) => p.isStarter)
              .map((p, i) => (
                <li key={i}>
                  {p.steamName} — {p.primaryPosition}
                </li>
              ))}
            {teamARoster.filter((p) => !p.isStarter).length > 0 && (
              <li className="text-muted-foreground">
                替补：
                {teamARoster
                  .filter((p) => !p.isStarter)
                  .map((p) => p.steamName)
                  .join("、")}
              </li>
            )}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">未提交</p>
        )}
      </div>
      <div>
        <h4 className="font-medium">{teamBName}</h4>
        {teamBRoster && teamBRoster.length > 0 ? (
          <ul className="mt-1 space-y-1 text-sm">
            {teamBRoster
              .filter((p) => p.isStarter)
              .map((p, i) => (
                <li key={i}>
                  {p.steamName} — {p.primaryPosition}
                </li>
              ))}
            {teamBRoster.filter((p) => !p.isStarter).length > 0 && (
              <li className="text-muted-foreground">
                替补：
                {teamBRoster
                  .filter((p) => !p.isStarter)
                  .map((p) => p.steamName)
                  .join("、")}
              </li>
            )}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">未提交</p>
        )}
      </div>
    </div>
  );
}
