// TODO: draft spectator view — 8-team grid, countdown timer, remaining player pool, realtime
interface DraftPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function DraftPage({ params }: DraftPageProps) {
  const { seasonSlug } = await params;
  return (
    <div className="container mx-auto px-4 py-16">
      <h1 className="text-3xl font-bold mb-8">选秀直播间 · {seasonSlug.toUpperCase()}</h1>
      <p className="text-[var(--text-secondary)]">选秀状态加载中...</p>
    </div>
  );
}
