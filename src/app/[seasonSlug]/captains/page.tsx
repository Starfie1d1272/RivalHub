// TODO: captain candidates list with realtime vote counts
interface CaptainsPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function CaptainsPage({ params }: CaptainsPageProps) {
  const { seasonSlug } = await params;
  return (
    <div className="container mx-auto px-4 py-16">
      <h1 className="text-3xl font-bold mb-8">队长投票 · {seasonSlug.toUpperCase()}</h1>
      <p className="text-[var(--text-secondary)]">候选人列表加载中...</p>
    </div>
  );
}
