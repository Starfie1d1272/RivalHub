import type { ReactNode } from "react";
import type { PublicPlayerIdentity } from "@/lib/identity/public-player";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { PosChip } from "@/components/rivalhub";

export function TeamRoster({
  title,
  members,
  groups,
  action,
}: {
  title: string;
  members: readonly (PublicPlayerIdentity & { captain?: boolean; label?: ReactNode })[];
  groups?: readonly { label: string; members: typeof members }[];
  action?: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {title}{" "}
          <span className="ml-1 text-xs font-normal text-[var(--color-fg-mid)]">
            {members.length}
          </span>
        </h2>
        {action}
      </div>
      <div className="border-y border-[var(--color-border)] px-1">
        {(groups?.some((group) => group.members.length)
          ? groups.filter((group) => group.members.length)
          : [{ label: "", members }]
        ).map((group) => (
          <div key={group.label} className="py-1">
            {group.label && (
              <p className="pt-2 text-xs text-[var(--color-fg-mid)]">
                {group.label} · {group.members.length}
              </p>
            )}
            <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-3 lg:grid-cols-5">
              {group.members.length > 0 ? (
                group.members.map((member) => (
                  <div
                    key={member.userId}
                    className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <PlayerAvatar
                        name={member.name}
                        avatarUrl={member.avatarUrl}
                        hasActivePublicSanction={member.hasActivePublicSanction}
                        size="sm"
                      />
                      {member.captain && <PosChip pos="C" small />}
                      <PlayerProfileLink
                        userId={member.userId}
                        className="min-w-0 break-words font-medium hover:text-[var(--color-accent)]"
                      >
                        {member.name}
                      </PlayerProfileLink>
                    </div>
                    {!group.label && member.label && (
                      <span className="text-xs text-[var(--color-fg-mid)]">{member.label}</span>
                    )}
                  </div>
                ))
              ) : (
                <p className="py-4 text-sm text-[var(--color-fg-mid)]">{title}暂无可展示成员。</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
