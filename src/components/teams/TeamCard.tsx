import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { TeamLogo } from "@/components/teams/TeamLogo";
import { matchesDirectorySearch } from "@/lib/players/directory-query";

interface PlayerPreview {
  name: string;
  avatarUrl: string | null;
  isStarter: boolean;
  userId?: string | null;
}

export function TeamCard({ entryId, teamName, seasonSlug, logoUrl, players, placement, query = "" }: {
  entryId: string;
  teamName: string;
  seasonSlug: string;
  logoUrl?: string | null;
  players: PlayerPreview[];
  placement?: string;
  query?: string;
}) {
  const groups = [
    { label: "首发", players: players.filter(player => player.isStarter) },
    { label: "替补", players: players.filter(player => !player.isStarter) },
  ];
  return <section className="min-w-0 border border-[var(--color-border)] bg-[var(--color-panel)] p-4">
    <div className="mb-4 flex items-center justify-between gap-3">
      <TeamProfileLink seasonSlug={seasonSlug} entryId={entryId} className="flex min-w-0 items-center gap-3 hover:text-[var(--color-accent)]">
        <TeamLogo logoUrl={logoUrl ?? null} teamName={teamName} />
        <h2 className="min-w-0 break-words font-semibold">{teamName}</h2>
      </TeamProfileLink>
      {placement && <span className="shrink-0 text-xs font-semibold text-[var(--color-accent)]">{placement}</span>}
    </div>
    <div className="space-y-3">
      {groups.filter(group => group.players.length > 0).map(group => <div key={group.label}>
        <p className="mb-2 text-xs text-[var(--color-fg-dim)]">{group.label} · {group.players.length}</p>
        <div className="grid grid-cols-2 gap-2">
          {group.players.map((player, index) => <div key={player.userId ?? index} className={`flex min-w-0 items-center gap-2 py-1 ${query && matchesDirectorySearch(query, player.name) ? "rounded-sm bg-[var(--color-accent-soft)] text-[var(--color-accent)]" : ""}`}>
            <PlayerAvatar name={player.name} avatarUrl={player.avatarUrl} size="sm" />
            {player.userId ? <PlayerProfileLink userId={player.userId} title={player.name} className="min-w-0 truncate text-sm hover:underline">{player.name}</PlayerProfileLink> : <span title={player.name} className="truncate text-sm">{player.name}</span>}
          </div>)}
        </div>
      </div>)}
      {players.length === 0 && <p className="text-sm text-[var(--color-fg-mid)]">暂无公开阵容</p>}
    </div>
  </section>;
}
