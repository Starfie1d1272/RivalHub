import { cn } from "@/lib/utils/cn";

interface StatProps {
  label: string;
  value: string | number;
  sub?: string | null;
  accent?: boolean;
}

export function Stat({ label, value, sub, accent }: StatProps) {
  return (
    <div
      className="p-3 border rounded-md min-w-0"
      style={{
        background: "var(--color-panel-low)",
        borderColor: "var(--color-border)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <div
        className="mb-1.5 uppercase"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--color-fg-mid)",
          letterSpacing: "var(--tracking-label)",
        }}
      >
        {label}
      </div>
      <div
        className="font-bold leading-none"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 22,
          color: accent ? "var(--color-accent)" : "var(--color-fg)",
          letterSpacing: "var(--tracking-tight-2)",
        }}
      >
        {value}
      </div>
      {sub != null && (
        <div
          className="mt-1"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--color-fg-dim)",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

interface MiniStatProps {
  label: string;
  value: string | number;
  accent?: boolean;
}

export function MiniStat({ label, value, accent }: MiniStatProps) {
  return (
    <div className="text-right leading-tight">
      <div
        className="uppercase"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "var(--color-fg-dim)",
          letterSpacing: "var(--tracking-label)",
        }}
      >
        {label}
      </div>
      <div
        className="font-bold"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          color: accent ? "var(--color-accent)" : "var(--color-fg)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
