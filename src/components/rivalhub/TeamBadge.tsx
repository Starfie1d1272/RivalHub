interface TeamBadgeProps {
  team: { tag: string; color: string };
  size?: number;
}

export function TeamBadge({ team, size = 36 }: TeamBadgeProps) {
  return (
    <div
      className="relative grid place-items-center flex-shrink-0 font-bold"
      style={{
        width: size,
        height: size,
        background: team.color + "22",
        border: `1px solid ${team.color}55`,
        borderRadius: "var(--radius-sm)",
        fontFamily: "var(--font-mono)",
        fontSize: size * 0.36,
        color: team.color,
      }}
    >
      <span
        className="absolute inset-0"
        style={{
          borderRadius: "var(--radius-sm)",
          background: `linear-gradient(135deg, ${team.color}10 0%, transparent 50%)`,
        }}
      />
      <span className="relative">{team.tag}</span>
    </div>
  );
}
