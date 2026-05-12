interface RivalSkeletonProps {
  w?: string;
  h?: number;
  mt?: number;
  radius?: number;
}

export function RivalSkeleton({ w = "100%", h = 16, mt = 0, radius }: RivalSkeletonProps) {
  return (
    <div
      className="skeleton"
      style={{
        width: w,
        height: h,
        marginTop: mt,
        borderRadius: radius ?? "var(--radius-sm)",
      }}
    />
  );
}

export function SkeletonRow({ cols = [1, 2, 1, 1] }: { cols?: number[] }) {
  return (
    <div
      className="grid gap-3.5 px-4 py-3"
      style={{
        gridTemplateColumns: cols.map((c) => `${c}fr`).join(" "),
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {cols.map((_, i) => (
        <RivalSkeleton key={i} h={14} />
      ))}
    </div>
  );
}

export function Spinner({
  size = 18,
  label,
}: {
  size?: number;
  label?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-block rounded-full animate-spin"
        style={{
          width: size,
          height: size,
          border: `2px solid var(--color-border)`,
          borderTopColor: "var(--color-accent)",
        }}
      />
      {label && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-fg-mid)",
            letterSpacing: "var(--tracking-label)",
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
