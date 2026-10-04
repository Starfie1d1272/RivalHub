"use client";
export default function StatsError({ reset }: { reset: () => void }) {
  return <div role="alert" className="mx-auto max-w-7xl space-y-3 px-4 py-8"><p>统计数据暂时无法加载，请稍后重试。</p><button type="button" onClick={reset} className="underline">重试</button></div>;
}
