interface MarkerProps {
  children: React.ReactNode;
  num?: number;
  sub?: string;
  action?: React.ReactNode;
}

export function Marker({ children, num, sub, action }: MarkerProps) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3.5">
      <div className="flex items-baseline gap-3 min-w-0">
        {num != null && (
          <div
            className="font-bold"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-accent)",
              letterSpacing: "var(--tracking-label)",
            }}
          >
            [ {String(num).padStart(2, "0")} ]
          </div>
        )}
        <div
          className="font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 22,
            color: "var(--color-fg)",
            letterSpacing: "var(--tracking-tight-1)",
          }}
        >
          {children}
        </div>
        {sub && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-fg-dim)",
              letterSpacing: "var(--tracking-ticker)",
            }}
          >
            {sub}
          </div>
        )}
      </div>
      {action}
    </div>
  );
}
