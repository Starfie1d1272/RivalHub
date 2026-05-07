// TODO: captain pick panel — authenticated captain only, pick action, countdown
interface DraftCaptainPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function DraftCaptainPage({ params }: DraftCaptainPageProps) {
  const { seasonSlug } = await params;
  return (
    <div className="container mx-auto px-4 py-16 max-w-2xl">
      <h1 className="text-3xl font-bold mb-8">队长选人 · {seasonSlug.toUpperCase()}</h1>
      <p className="text-[var(--text-secondary)]">队长面板加载中...</p>
    </div>
  );
}
