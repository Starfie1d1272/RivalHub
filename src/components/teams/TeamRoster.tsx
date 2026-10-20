import type { ReactNode } from "react";
import type { PublicPlayerIdentity } from "@/lib/identity/public-player";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { PosChip } from "@/components/rivalhub";

export function TeamRoster({ title, members }: {
  title: string;
  members: readonly (PublicPlayerIdentity & { captain?: boolean; label?: ReactNode })[];
}) {
  return <section className="space-y-4">
    <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-fg-dim)]">MEMBERS</p><h2 className="mt-1 text-lg font-semibold">{title}</h2></div>
    <div className="border-y border-[var(--color-border)] px-1">
      <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-3 lg:grid-cols-5">
        {members.length > 0 ? members.map(member => <div key={member.userId} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <PlayerAvatar name={member.name} avatarUrl={member.avatarUrl} hasActivePublicSanction={member.hasActivePublicSanction} size="sm" />
            {member.captain && <PosChip pos="C" small />}
            <PlayerProfileLink userId={member.userId} className="min-w-0 break-words font-medium hover:text-[var(--color-accent)]">{member.name}</PlayerProfileLink>
          </div>
          {member.label && <span className="text-xs text-[var(--color-fg-mid)]">{member.label}</span>}
        </div>) : <p className="py-4 text-sm text-[var(--color-fg-mid)]">{title}暂无可展示成员。</p>}
      </div>
    </div>
  </section>;
}
