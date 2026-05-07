// TODO: bracket overview — brackets-viewer render, all matches list
interface MatchesPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function MatchesPage({ params }: MatchesPageProps) {
  const { seasonSlug } = await params;
  return (
    <div className="container mx-auto px-4 py-16">
      <h1 className="text-3xl font-bold mb-8">赛程总览 · {seasonSlug.toUpperCase()}</h1>
      <p className="text-[var(--text-secondary)]">赛程图加载中...</p>
    </div>
  );
}
