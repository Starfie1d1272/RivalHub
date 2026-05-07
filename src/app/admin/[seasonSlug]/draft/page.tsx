// TODO: admin draft control — start draft, advance round, override pick, reset
interface AdminDraftPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function AdminDraftPage({ params }: AdminDraftPageProps) {
  const { seasonSlug } = await params;
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">选秀管理 · {seasonSlug.toUpperCase()}</h1>
      <p className="text-[var(--text-secondary)]">选秀状态加载中...</p>
    </div>
  );
}
