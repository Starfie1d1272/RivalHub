export function Footer() {
  return (
    <footer
      className="flex justify-between items-center"
      style={{
        padding: "20px 28px",
        borderTop: "1px solid var(--color-border)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--color-fg-dim)",
        letterSpacing: "var(--tracking-ticker)",
      }}
    >
      <div>RIVALHUB · OPEN SOURCE ESPORTS TOURNAMENT PLATFORM</div>
      <div className="flex gap-3.5">
        <span>GITHUB ↗</span>
        <span>RULES</span>
        <span>PRIVACY</span>
        <span style={{ color: "var(--color-accent)" }}>v4.0-A</span>
      </div>
    </footer>
  );
}
