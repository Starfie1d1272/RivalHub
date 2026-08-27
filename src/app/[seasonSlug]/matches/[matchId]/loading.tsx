export default function MatchDetailLoading() {
  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl space-y-8">
      {/* Hero header skeleton */}
      <div className="rounded-sm bg-[var(--color-panel)] animate-pulse p-6 space-y-4">
        <div className="h-6 w-48 bg-[var(--color-panel-hi)] rounded-sm" />
        <div className="flex items-center justify-between">
          <div className="h-10 w-32 bg-[var(--color-panel-hi)] rounded-sm" />
          <div className="h-6 w-16 bg-[var(--color-panel-hi)] rounded-sm" />
          <div className="h-10 w-32 bg-[var(--color-panel-hi)] rounded-sm" />
        </div>
      </div>

      {/* Tab skeleton */}
      <div className="space-y-3">
        <div className="flex gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-24 bg-[var(--color-panel)] animate-pulse rounded-sm" />
          ))}
        </div>
        <div className="rounded-sm bg-[var(--color-panel)] animate-pulse p-6 space-y-4">
          <div className="h-4 w-3/4 bg-[var(--color-panel-hi)] rounded-sm" />
          <div className="h-4 w-1/2 bg-[var(--color-panel-hi)] rounded-sm" />
          <div className="h-4 w-5/6 bg-[var(--color-panel-hi)] rounded-sm" />
          <div className="h-4 w-2/3 bg-[var(--color-panel-hi)] rounded-sm" />
        </div>
      </div>
    </div>
  );
}
