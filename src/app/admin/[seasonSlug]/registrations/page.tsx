// TODO: admin registration review — list, filter by status, approve/reject/waitlist
interface AdminRegistrationsPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function AdminRegistrationsPage({ params }: AdminRegistrationsPageProps) {
  const { seasonSlug } = await params;
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">报名审核 · {seasonSlug.toUpperCase()}</h1>
      <p className="text-[var(--text-secondary)]">报名列表加载中...</p>
    </div>
  );
}
