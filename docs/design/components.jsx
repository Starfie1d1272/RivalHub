/* global React */

// Shared building blocks used by all screens, themed via useVariant().

const { useState, useEffect, useRef, useMemo } = React;

/* ------- Placeholder avatar: striped block + letter ------- */
function Avatar({ name, size = 36, color }) {
  const v = useVariant();
  const seed = (name || "??").charCodeAt(0) + (name || "??").charCodeAt(1 % (name?.length || 1) || 0);
  const stripes = [v.panelHi, v.panelLow, v.border];
  const bg = color || stripes[seed % stripes.length];
  const letter = (name || "?").replace(/[^a-z0-9]/gi, "")[0]?.toUpperCase() || "?";
  return (
    <div
      style={{
        width: size, height: size,
        background: `repeating-linear-gradient(135deg, ${bg} 0 4px, ${v.panelLow} 4px 8px)`,
        border: `1px solid ${v.border}`,
        borderRadius: v.rmd,
        display: "grid", placeItems: "center",
        fontFamily: v.monoFont,
        fontSize: size * 0.42,
        fontWeight: 700,
        color: v.text,
        letterSpacing: "-0.02em",
        flexShrink: 0,
      }}
    >{letter}</div>
  );
}

/* ------- Team badge (initials in colored tile) ------- */
function TeamBadge({ team, size = 36 }) {
  const v = useVariant();
  return (
    <div style={{
      width: size, height: size,
      background: team.color + "22",
      border: `1px solid ${team.color}55`,
      borderRadius: v.rsm,
      display: "grid", placeItems: "center",
      fontFamily: v.monoFont, fontSize: size * 0.36, fontWeight: 700,
      color: team.color, letterSpacing: 0,
      flexShrink: 0,
      position: "relative",
    }}>
      <span style={{ position:"absolute", inset:0, borderRadius:v.rsm,
        background: `linear-gradient(135deg, ${team.color}10 0%, transparent 50%)` }} />
      <span style={{ position:"relative" }}>{team.tag}</span>
    </div>
  );
}

/* ------- Position chip ------- */
function PosChip({ pos, small }) {
  const v = useVariant();
  return (
    <span style={{
      display:"inline-flex", alignItems:"center",
      padding: small ? "1px 5px" : "2px 7px",
      fontFamily: v.monoFont, fontSize: small ? 9 : 10, fontWeight: 700,
      letterSpacing: "0.05em",
      color: v.accent,
      border: `1px solid ${v.accent}55`,
      background: v.accent + "12",
      borderRadius: v.rsm,
    }}>{pos}</span>
  );
}

/* ------- Status pill ------- */
function StatusPill({ status }) {
  const v = useVariant();
  const cfg = {
    live: { c: v.danger, t: "● LIVE" },
    finished: { c: v.textDim, t: "FT" },
    scheduled: { c: v.textMid, t: "UPCOMING" },
    open: { c: v.ok, t: "● OPEN" },
    voting: { c: v.warn, t: "● VOTING" },
    drafting: { c: v.accent, t: "● DRAFTING" },
    playing: { c: v.ok, t: "● PLAYING" },
  }[status] || { c: v.textMid, t: status };
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", gap:6,
      padding: "3px 8px",
      fontFamily: v.monoFont, fontSize: 10, fontWeight: 700,
      letterSpacing: "0.1em",
      color: cfg.c,
      border: `1px solid ${cfg.c}55`,
      background: cfg.c + "12",
      borderRadius: v.rsm,
    }}>{cfg.t}</span>
  );
}

/* ------- Panel ------- */
function Panel({ children, style, hi, label, pad = 16 }) {
  const v = useVariant();
  return (
    <div style={{
      background: hi ? v.panelHi : v.panel,
      border: `1px solid ${v.border}`,
      borderRadius: v.rlg,
      position: "relative",
      ...style,
    }}>
      {label && (
        <div style={{
          padding: "10px 16px",
          borderBottom: `1px solid ${v.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          fontFamily: v.monoFont, fontSize: 11, fontWeight: 700,
          letterSpacing: "0.12em",
          color: v.textMid,
          textTransform: "uppercase",
        }}>
          {typeof label === "string" ? <span>{label}</span> : label}
        </div>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </div>
  );
}

/* ------- Button ------- */
function Btn({ children, primary, ghost, danger, onClick, full, small, style, disabled }) {
  const v = useVariant();
  const base = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
    fontFamily: v.bodyFont,
    fontSize: small ? 12 : 13, fontWeight: 600,
    padding: small ? "6px 12px" : "9px 16px",
    borderRadius: v.rsm,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    transition: "all 120ms ease",
    width: full ? "100%" : undefined,
    letterSpacing: v.id === "B" ? "0.04em" : "0",
    textTransform: v.id === "B" ? "uppercase" : "none",
    border: "1px solid",
    userSelect: "none",
  };
  let cs = { background: "transparent", color: v.text, borderColor: v.border };
  if (primary) cs = { background: v.accent, color: "#0a0c10", borderColor: v.accent };
  if (ghost) cs = { background: "transparent", color: v.textMid, borderColor: "transparent" };
  if (danger) cs = { background: "transparent", color: v.danger, borderColor: v.danger + "55" };
  return <button onClick={disabled ? undefined : onClick} style={{ ...base, ...cs, ...style }}>{children}</button>;
}

/* ------- Stat tile (number + label) ------- */
function Stat({ label, value, sub, accent }) {
  const v = useVariant();
  return (
    <div style={{
      padding: "12px 14px",
      background: v.panelLow,
      border: `1px solid ${v.border}`,
      borderRadius: v.rmd,
      minWidth: 0,
    }}>
      <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textMid, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:6 }}>{label}</div>
      <div style={{
        fontFamily: v.monoFont, fontSize: 22, fontWeight: 700,
        color: accent ? v.accent : v.text,
        letterSpacing: "-0.02em",
        lineHeight: 1,
      }}>{value}</div>
      {sub != null && (
        <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim, marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}

/* ------- Marker (display heading) ------- */
function Marker({ children, num, sub, action }) {
  const v = useVariant();
  return (
    <div style={{
      display: "flex", alignItems: "flex-end", justifyContent:"space-between",
      gap: 12, marginBottom: 14,
    }}>
      <div style={{ display:"flex", alignItems:"baseline", gap:12, minWidth:0 }}>
        {num != null && (
          <div style={{
            fontFamily: v.monoFont, fontSize: 11, fontWeight: 700, color: v.accent,
            letterSpacing: "0.12em",
          }}>[ {String(num).padStart(2,"0")} ]</div>
        )}
        <div style={{
          fontFamily: v.displayFont, fontSize: 22, fontWeight: v.displayWeight,
          color: v.text, letterSpacing: v.displayTracking,
          textTransform: v.displayTransform,
        }}>{children}</div>
        {sub && <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim, letterSpacing:"0.06em" }}>{sub}</div>}
      </div>
      {action}
    </div>
  );
}

/* ------- Diagonal slash divider (used in variant B) ------- */
function Slash({ style }) {
  const v = useVariant();
  if (v.id !== "B") return null;
  return (
    <div style={{
      height: 14,
      background: `repeating-linear-gradient(-60deg, ${v.accent} 0 2px, transparent 2px 8px)`,
      opacity: 0.5,
      ...style,
    }} />
  );
}

/* ------- Bar fill (used in voting + capacity) ------- */
function Bar({ pct, color }) {
  const v = useVariant();
  return (
    <div style={{
      height: 4, background: v.border, borderRadius: 999, overflow: "hidden",
    }}>
      <div style={{
        height: "100%", width: pct + "%",
        background: color || v.accent,
        transition: "width 400ms ease",
      }} />
    </div>
  );
}

/* ------- MiniStat: compact label + value (right-aligned column cell) ------- */
function MiniStat({ label, value, accent }) {
  const v = useVariant();
  return (
    <div style={{ textAlign: "right", lineHeight: 1.2 }}>
      <div style={{ fontFamily: v.monoFont, fontSize: 9, color: v.textDim, letterSpacing: "0.12em" }}>{label}</div>
      <div style={{ fontFamily: v.monoFont, fontSize: 13, fontWeight: 700, color: accent ? v.accent : v.text }}>{value}</div>
    </div>
  );
}

/* ------- Label (form caption) ------- */
function Label({ children }) {
  const v = useVariant();
  return (
    <div style={{
      fontFamily: v.monoFont, fontSize: 10, fontWeight: 700,
      color: v.textMid, letterSpacing: "0.14em",
    }}>{children}</div>
  );
}

/* ------- Field (label + input pair) ------- */
function Field({ label, value, onChange, mono, type = "text", placeholder }) {
  const v = useVariant();
  return (
    <div>
      {label && <Label>{label}</Label>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%", padding: "10px 12px", marginTop: 6,
          background: v.panelLow, border: `1px solid ${v.border}`,
          color: v.text, fontFamily: mono ? v.monoFont : v.bodyFont, fontSize: 13,
          outline: "none", borderRadius: v.rsm,
        }}
      />
    </div>
  );
}

/* ------- KV (mono key·value row) ------- */
function KV({ k, val }) {
  const v = useVariant();
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: v.textDim, letterSpacing: "0.08em" }}>{k}</span>
      <span>{val}</span>
    </div>
  );
}

Object.assign(window, { Avatar, TeamBadge, PosChip, StatusPill, Panel, Btn, Stat, MiniStat, Marker, Slash, Bar, Field, Label, KV });
