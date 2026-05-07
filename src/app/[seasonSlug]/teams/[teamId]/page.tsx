// TODO: team detail — roster by position, match history
interface TeamDetailPageProps {
  params: Promise<{ seasonSlug: string; teamId: string }>;
}

export default async function TeamDetailPage({ params }: TeamDetailPageProps) {
  const { seasonSlug, teamId } = await params;
  return (
    <div className="container mx-auto px-4 py-16 max-w-3xl">
      <h1 className="text-3xl font-bold mb-8">队伍详情 · {seasonSlug.toUpperCase()}</h1>
      <p className="text-[var(--text-secondary)]">teamId: {teamId}</p>
    </div>
  );
}
