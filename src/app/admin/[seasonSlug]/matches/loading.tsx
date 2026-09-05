import { Panel } from "@/components/rivalhub";

export default function Loading() {
  return (
    <div className="min-w-0 space-y-5">
      <div className="space-y-2">
        <div className="h-3 w-24 animate-pulse rounded bg-[var(--color-panel-hi)]" />
        <div className="h-8 w-48 animate-pulse rounded bg-[var(--color-panel-hi)]" />
      </div>
      <Panel contentClassName="p-5">
        <div className="h-48 animate-pulse rounded bg-[var(--color-panel-hi)]" />
      </Panel>
    </div>
  );
}
