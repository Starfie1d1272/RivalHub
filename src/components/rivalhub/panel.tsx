import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

interface PanelProps {
  children: React.ReactNode;
  className?: string;
  hi?: boolean;
  label?: string;
  pad?: number;
}

export function Panel({ children, className, hi, label, pad = 16 }: PanelProps) {
  return (
    <Card
      className={cn(className)}
      style={{ background: hi ? "var(--color-panel-hi)" : "var(--color-panel)" }}
    >
      {label && (
        <CardHeader
          className="flex flex-row items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "var(--tracking-label)",
            color: "var(--color-fg-mid)",
            textTransform: "uppercase",
          }}
        >
          {label}
        </CardHeader>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </Card>
  );
}
