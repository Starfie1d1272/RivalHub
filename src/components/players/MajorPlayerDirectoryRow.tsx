import React from "react";
import type { MajorPublicParticipantPlayer } from "@/lib/major/public-participants";
import { EventPlayerDirectoryRow } from "@/components/players/EventPlayerDirectoryRow";

export function MajorPlayerDirectoryRow({
  player,
  seasonSlug,
}: {
  player: MajorPublicParticipantPlayer;
  seasonSlug: string;
}) {
  return <EventPlayerDirectoryRow player={player} seasonSlug={seasonSlug} />;
}
