// TODO: admin match management — create matches, input results, update bracket
interface AdminMatchesPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function AdminMatchesPage({ params }: AdminMatchesPageProps) {
  const { seasonSlug } = await params;
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">比赛管理 · {seasonSlug.toUpperCase()}</h1>
      <p className="text-[var(--text-secondary)]">比赛列表加载中...</p>
    </div>
  );
}
