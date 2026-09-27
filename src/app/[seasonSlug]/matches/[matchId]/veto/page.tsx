import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { PageLayout } from "@/components/rivalhub";
import { VetoRoom } from "@/components/matches/VetoRoom";
import { db } from "@/db/client";
import { matches } from "@/db/schema";
import { getPublicOrAuthorizedDraftSeason } from "@/lib/data/public-seasons";
import { getVetoRoomView } from "@/lib/matches/veto-room/read-model";

interface VetoRoomPageProps {
  params: Promise<{ seasonSlug: string; matchId: string }>;
}

export default async function VetoRoomPage({ params }: VetoRoomPageProps) {
  const { seasonSlug, matchId } = await params;
  const [season, match] = await Promise.all([
    getPublicOrAuthorizedDraftSeason(seasonSlug),
    db.query.matches.findFirst({ where: eq(matches.id, matchId) }),
  ]);
  if (!season || !match || match.seasonId !== season.id) notFound();

  const room = await getVetoRoomView(matchId);
  return (
    <PageLayout as="main" variant="standard" className="py-0">
      <VetoRoom initialRoom={room} />
    </PageLayout>
  );
}
