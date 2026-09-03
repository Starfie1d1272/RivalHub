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
