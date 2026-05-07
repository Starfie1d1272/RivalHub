// TODO: teams listing page — all teams with rosters overview
interface TeamsPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function TeamsPage({ params }: TeamsPageProps) {
  const { seasonSlug } = await params;
  return (
    <div className="container mx-auto px-4 py-16">
      <h1 className="text-3xl font-bold mb-8">参赛队伍 · {seasonSlug.toUpperCase()}</h1>
      <p className="text-[var(--text-secondary)]">队伍列表加载中...</p>
    </div>
  );
}
