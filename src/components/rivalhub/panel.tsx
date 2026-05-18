import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

interface PanelProps {
  children: React.ReactNode;
  className?: string;
  hi?: boolean;
  label?: React.ReactNode;
  pad?: number;
  hoverable?: boolean;
  teamColor?: string;
}

export function Panel({ children, className, hi, label, pad = 16, hoverable, teamColor }: PanelProps) {
  return (
    <Card
      className={cn(
        hoverable && "transition-all duration-[180ms] ease-out hover:-translate-y-0.5 hover:border-[var(--color-border-hi)] hover:shadow-[0_4px_20px_rgba(255,107,26,0.03)]",
        className
      )}
      style={{
        background: hi ? "var(--color-panel-hi)" : "var(--color-panel)",
        ...(teamColor ? { borderTop: `3px solid ${teamColor}` } : {}),
      }}
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
          {typeof label === "string" ? <span>{label}</span> : label}
        </CardHeader>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </Card>
  );
}
