interface PosChipProps {
  pos: string;
  small?: boolean;
}

export function PosChip({ pos, small }: PosChipProps) {
  return (
    <span
      className="inline-flex items-center font-bold rounded-sm border"
      style={{
        padding: small ? "1px 5px" : "2px 7px",
        fontFamily: "var(--font-mono)",
        fontSize: small ? 9 : 10,
        letterSpacing: "0.05em",
        color: "var(--color-accent)",
        borderColor: "var(--color-accent-edge)",
        background: "var(--color-accent-soft)",
      }}
    >
      {pos}
    </span>
  );
}
