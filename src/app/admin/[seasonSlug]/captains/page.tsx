// TODO: admin captain confirmation — view vote results, confirm top-8, generate teams + draft_order
interface AdminCaptainsPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function AdminCaptainsPage({ params }: AdminCaptainsPageProps) {
  const { seasonSlug } = await params;
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">队长确认 · {seasonSlug.toUpperCase()}</h1>
      <p className="text-[var(--text-secondary)]">投票结果加载中...</p>
    </div>
  );
}
