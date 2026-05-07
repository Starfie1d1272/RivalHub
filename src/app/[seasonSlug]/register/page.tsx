// TODO: registration form — position slots, screenshot upload, magic link
interface RegisterPageProps {
  params: Promise<{ seasonSlug: string }>;
}

export default async function RegisterPage({ params }: RegisterPageProps) {
  const { seasonSlug } = await params;
  return (
    <div className="container mx-auto px-4 py-16 max-w-2xl">
      <h1 className="text-3xl font-bold mb-8">报名 · {seasonSlug.toUpperCase()}</h1>
      <p className="text-[var(--text-secondary)]">报名表单加载中...</p>
    </div>
  );
}
