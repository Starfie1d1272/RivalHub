import { PlayerProfileLink } from "@/components/players/PlayerProfileLink";
import { TeamProfileLink } from "@/components/teams/TeamProfileLink";
import type { BetMarketDTO } from "@/lib/bet/types";
export function BetOptionProfile({ option, slug }: { option: BetMarketDTO["options"][number]; slug: string }) {
  if (!option.entity) return null;
  const props = { variant: "dense" as const, "aria-label": `查看 ${option.label} 资料`, children: "↗" };
  return option.entity.kind === "player" ? <PlayerProfileLink userId={option.entity.userId} {...props} /> : <TeamProfileLink entryId={option.entity.entryId} seasonSlug={slug} {...props} />;
}
