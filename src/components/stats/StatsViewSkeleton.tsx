/** Reserve the summary, controls and table regions while the selected view loads. */
export function StatsViewSkeleton() {
  return <div role="status" aria-label="正在加载统计视图" className="min-h-[42rem] space-y-5 animate-pulse">
    <div className="h-14 border-b border-[var(--color-border)] bg-[var(--color-panel-low)]" />
    <div className="h-24 border-y border-[var(--color-border)] bg-[var(--color-panel-low)]" />
    <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map(index => <div key={index} className="h-56 border-y border-[var(--color-border)] bg-[var(--color-panel-low)]" />)}
    </div>
    <div className="h-64 border-y border-[var(--color-border)] bg-[var(--color-panel-low)]" />
    <div className="h-56 border-y border-[var(--color-border)] bg-[var(--color-panel-low)]" />
  </div>;
}
