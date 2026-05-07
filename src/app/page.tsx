// TODO: detect active season and redirect to /[seasonSlug] or show season list
export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-16 text-center">
      <h1 className="text-4xl font-bold mb-4">NJU CS2 Platform</h1>
      <p className="text-[var(--text-secondary)]">南京大学 CS2 社团赛事管理平台</p>
    </div>
  );
}
