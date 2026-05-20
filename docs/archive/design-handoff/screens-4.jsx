/* global React, MOCK, useVariant */

/* =========================================================================
   TEAMS LIST + TEAM DETAIL
   ========================================================================= */
function TeamsScreen({ go }) {
  const v = useVariant();
  return (
    <div style={{ padding: "32px 36px" }}>
      <Marker num={4} sub="8 TEAMS CONFIRMED">战队</Marker>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {MOCK.teams.map((t) => (
          <button key={t.id} onClick={() => go("team")} style={{
            cursor: "pointer", textAlign: "left", background: v.panel,
            border: `1px solid ${v.border}`, borderRadius: v.rmd, padding: 0, overflow: "hidden",
            transition: "all 200ms",
          }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.color; e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = v.border; e.currentTarget.style.transform = "translateY(0)"; }}
          >
            <div style={{ height: 6, background: t.color }} />
            <div style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <TeamBadge team={t} size={48} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: v.displayFont, fontWeight: v.displayWeight, fontSize: 18, color: v.text, letterSpacing: v.displayTracking }}>{t.name}</div>
                  <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim }}>SEED #{t.seed} · CPT {t.captain?.tag}</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 14 }}>
                <Stat label="W-L" value={`${t.record.w}-${t.record.l}`} />
                <Stat label="MAP Δ" value={(t.map_diff > 0 ? "+" : "") + t.map_diff} />
                <Stat label="STREAK" value="W3" accent />
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 14, flexWrap: "wrap" }}>
                {t.roster.slice(0, 5).map((p) => <PosChip key={p.id} pos={p.pos} small />)}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TeamDetailScreen({ go }) {
  const v = useVariant();
  const t = MOCK.teams[0];
  const starters = t.roster.filter((p) => p.starter);
  const subs = t.roster.filter((p) => !p.starter);

  return (
    <div style={{ padding: "0 0 32px" }}>
      {/* hero */}
      <div style={{
        padding: "32px 36px",
        background: `linear-gradient(120deg, ${t.color}18 0%, transparent 60%)`,
        borderBottom: `1px solid ${v.border}`,
        display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 24, alignItems: "center",
      }}>
        <TeamBadge team={t} size={96} />
        <div>
          <div style={{ fontFamily: v.monoFont, fontSize: 11, color: t.color, letterSpacing: "0.2em" }}>[ SEED #{t.seed} · CAPTAIN'S TEAM ]</div>
          <h1 style={{ fontFamily: v.displayFont, fontWeight: v.displayWeight, fontSize: 56, margin: "6px 0", color: v.text, letterSpacing: v.displayTracking, textTransform: v.displayTransform }}>
            {t.name}
          </h1>
          <div style={{ display: "flex", gap: 18, fontFamily: v.monoFont, fontSize: 12, color: v.textMid }}>
            <span>队长 · <span style={{ color: t.color, fontWeight: 700 }}>{t.captain?.tag}</span></span>
            <span>·</span>
            <span>{t.record.w}-{t.record.l}</span>
            <span>·</span>
            <span>MAP Δ {(t.map_diff > 0 ? "+" : "") + t.map_diff}</span>
          </div>
        </div>
        <div style={{ display:"flex", gap: 8 }}>
          <Btn onClick={() => go("matches")}>赛程</Btn>
          <Btn primary>关注战队</Btn>
        </div>
      </div>

      <div style={{ padding: "24px 36px", display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 18 }}>
        <div>
          <Marker num={1} sub="STARTING 5">首发</Marker>
          <Panel pad={0}>
            {starters.map((p, i) => (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "auto 1.2fr repeat(4, 1fr) auto", gap: 14, padding: "14px 18px", borderBottom: i < starters.length - 1 ? `1px solid ${v.border}` : "none", alignItems: "center" }}>
                <Avatar name={p.tag} size={44} />
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap: 6 }}>
                    <div style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text, fontSize: 15 }}>{p.tag}</div>
                    {p.isCaptain && <span style={{ color: v.accent, fontFamily: v.monoFont, fontSize: 10, fontWeight: 700 }}>★ CAPTAIN</span>}
                  </div>
                  <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim, marginTop: 4 }}>{p.name}</div>
                </div>
                <MiniStat label="POS" value={<PosChip pos={p.pos} small />} />
                <MiniStat label="RATING" value={p.hltv.toFixed(2)} accent />
                <MiniStat label="ADR" value={Math.round(p.adr)} />
                <MiniStat label="K/D" value={p.kd.toFixed(2)} />
                <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim }}>R {p.peakRating}</div>
              </div>
            ))}
          </Panel>

          <div style={{ marginTop: 24 }}>
            <Marker num={2} sub="SUBSTITUTES">替补</Marker>
            <Panel pad={0}>
              {subs.map((p, i) => (
                <div key={p.id} style={{ display:"grid", gridTemplateColumns:"auto 1fr auto auto", gap: 12, padding: "12px 18px", borderBottom: i < subs.length - 1 ? `1px solid ${v.border}` : "none", alignItems: "center" }}>
                  <Avatar name={p.tag} size={32} />
                  <div>
                    <div style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text, fontSize: 13 }}>{p.tag}</div>
                    <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim }}>{p.name}</div>
                  </div>
                  <PosChip pos={p.pos} small />
                  <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid }}>R {p.peakRating}</div>
                </div>
              ))}
            </Panel>
          </div>
        </div>

        {/* sidebar */}
        <div style={{ display: "grid", gap: 16 }}>
          <Panel label="TEAM AVERAGES">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Stat label="RATING" value={(t.roster.reduce((s, p) => s + p.hltv, 0) / t.roster.length).toFixed(2)} accent />
              <Stat label="ADR" value={Math.round(t.roster.reduce((s, p) => s + p.adr, 0) / t.roster.length)} />
              <Stat label="K-D" value={(t.roster.reduce((s, p) => s + p.kd, 0) / t.roster.length).toFixed(2)} />
              <Stat label="WIN%" value="64%" />
            </div>
          </Panel>
          <Panel label="UPCOMING">
            {MOCK.matches.slice(13, 16).map((m, i) => {
              const opp = m.ta.id === t.id ? m.tb : m.ta;
              return (
                <div key={m.id} style={{ display:"grid", gridTemplateColumns:"auto 1fr auto", gap:10, alignItems:"center", padding: "10px 0", borderTop: i ? `1px solid ${v.border}` : "none" }}>
                  <TeamBadge team={opp} size={32} />
                  <div>
                    <div style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text, fontSize: 13 }}>vs {opp.name}</div>
                    <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid }}>{m.scheduledAt} · {m.time}</div>
                  </div>
                  <Btn small onClick={() => go("match")}>详情</Btn>
                </div>
              );
            })}
          </Panel>
          <Panel label="POSITION HEATMAP">
            <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 8 }}>
              {MOCK.positions.map((pos) => {
                const cnt = t.roster.filter((p) => p.pos === pos).length;
                return (
                  <React.Fragment key={pos}>
                    <PosChip pos={pos} small />
                    <Bar pct={(cnt / 3) * 100} color={cnt >= 2 ? v.accent : v.textMid} />
                  </React.Fragment>
                );
              })}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, accent }) {
  const v = useVariant();
  return (
    <div>
      <div style={{ fontFamily: v.monoFont, fontSize: 9, color: v.textDim, letterSpacing: "0.12em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: v.monoFont, fontWeight: 700, fontSize: 14, color: accent ? v.accent : v.text }}>{value}</div>
    </div>
  );
}

window.TeamsScreen = TeamsScreen;
window.TeamDetailScreen = TeamDetailScreen;
