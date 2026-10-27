import Link from "next/link";
import { Panel, StatusPill } from "@/components/rivalhub";
import type { HealthItem } from "@/lib/service-health/contract";

export function ServiceHealthPanel({ items }: { items: HealthItem[] }) {
  return <section className="space-y-4" aria-labelledby="service-health-title">
    <div className="space-y-1"><h2 id="service-health-title" className="text-base font-semibold">服务健康与证据覆盖</h2>
      <p className="text-xs text-[var(--color-fg-mid)]">仅展示已有证据；未核验不表示故障。<Link className="underline" href="/admin/telemetry">查看产品遥测</Link></p></div>
    <Panel contentClassName="divide-y divide-[var(--color-border)] p-0">
      {items.map(item => <div key={item.label} className="space-y-2 p-4 text-sm">
        <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{item.label}</h3><StatusPill label={item.status} tone={item.status === "正常" ? "success" : item.status === "需要关注" ? "warn" : "neutral"} /></div>
        <p>来源与窗口：{item.source}</p><p>覆盖：{item.coverage}</p><p>原因：{item.reason}</p><p>排查：{item.action}</p>
      </div>)}
    </Panel>
  </section>;
}
