"use client";
import { PageLayout } from "@/components/rivalhub";
export default function StatsError({ reset }: { reset: () => void }) {
  return <PageLayout variant="wide" role="alert" className="space-y-3"><p>请重试加载统计数据。</p><button type="button" onClick={reset} className="underline">重试</button></PageLayout>;
}
