// TODO: match detail — both teams roster, score, maps, status machine, admin can input results
interface MatchDetailPageProps {
  params: Promise<{ seasonSlug: string; matchId: string }>;
}

export default async function MatchDetailPage({ params }: MatchDetailPageProps) {
  const { seasonSlug, matchId } = await params;
  return (
    <div className="container mx-auto px-4 py-16 max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">比赛详情 · {seasonSlug.toUpperCase()}</h1>
      <p className="text-[var(--text-secondary)]">matchId: {matchId}</p>
    </div>
  );
}
