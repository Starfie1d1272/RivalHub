"use client";
import { PageLayout } from "@/components/rivalhub";
export default function StatsError({ reset }: { reset: () => void }) {
  return <PageLayout variant="wide" role="alert" className="space-y-3"><p>统计数据暂时无法加载，请稍后重试。</p><button type="button" onClick={reset} className="underline">重试</button></PageLayout>;
}
