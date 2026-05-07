// TODO: season hero page — show season info, status, quick links
interface SeasonPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function SeasonPage({ params }: SeasonPageProps) {
  const { seasonSlug } = await params;
  return (
    <div className="container mx-auto px-4 py-16 text-center">
      <h1 className="text-4xl font-bold mb-4">{seasonSlug.toUpperCase()}</h1>
      <p className="text-[var(--text-secondary)]">赛季主页</p>
    </div>
  );
}
