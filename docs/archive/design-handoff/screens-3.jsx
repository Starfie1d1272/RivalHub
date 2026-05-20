/* global React, MOCK, useVariant */

/* =========================================================================
   DRAFT ROOM (/[seasonSlug]/draft) — live spectator + captain panel
   ========================================================================= */
function DraftScreen({ go }) {
  const v = useVariant();
  const [timer, setTimer] = React.useState(MOCK.draftState.timer);
  const [picked, setPicked] = React.useState(new Set(MOCK.draftState.log.map((l, i) => "p" + (i * 3))));
  const [filter, setFilter] = React.useState("ALL");
  const [captainView, setCaptainView] = React.useState(false);

  React.useEffect(() => {
    const t = setInterval(() => setTimer((x) => (x > 0 ? x - 1 : 120)), 1000);
    return () => clearInterval(t);
  }, []);

  const fmt = (s) => `${Math.floor(s/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`;
  const pickingTeam = MOCK.teams[MOCK.draftState.pickingTeam];
  const remaining = MOCK.players.filter((p) => !picked.has(p.id)).slice(0, 24);
  const pool = filter === "ALL" ? remaining : remaining.filter((p) => p.pos === filter);

  return (
    <div style={{ padding: "24px 28px", display: "grid", gap: 16 }}>
      {/* command bar */}
      <Panel pad={0}>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.4fr 1fr 1fr", alignItems: "stretch" }}>
          <div style={{ padding: "16px 20px", borderRight: `1px solid ${v.border}`, display:"flex", alignItems:"center", gap: 14 }}>
            <div style={{ width: 8, height: 40, background: v.danger, boxShadow: `0 0 12px ${v.danger}` }} />
            <div>
              <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.danger, letterSpacing:"0.2em", fontWeight: 700 }}>● LIVE</div>
              <div style={{ fontFamily: v.displayFont, fontSize: 18, fontWeight: v.displayWeight, color: v.text, marginTop: 4 }}>选秀直播间</div>
              <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid }}>观众 · 1,247</div>
            </div>
          </div>

          <div style={{ padding: "16px 20px", borderRight: `1px solid ${v.border}`, display: "flex", alignItems: "center", gap: 14 }}>
            <TeamBadge team={pickingTeam} size={56} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim, letterSpacing: "0.12em" }}>CURRENT PICK</div>
              <div style={{ fontFamily: v.displayFont, fontSize: 18, fontWeight: v.displayWeight, color: pickingTeam.color }}>{pickingTeam.name}</div>
              <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid }}>captain · k1ngd0m</div>
            </div>
          </div>

          <div style={{ padding: "16px 20px", borderRight: `1px solid ${v.border}` }}>
            <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim, letterSpacing: "0.12em" }}>TIMER</div>
            <div style={{
              fontFamily: v.monoFont, fontWeight: 700, fontSize: 36,
              color: timer < 20 ? v.danger : v.accent, letterSpacing: "-0.04em",
              lineHeight: 1, marginTop: 4, transition: "color 200ms",
            }}>{fmt(timer)}</div>
            <div style={{ marginTop: 6 }}>
              <Bar pct={(timer / 120) * 100} color={timer < 20 ? v.danger : v.accent} />
            </div>
          </div>

          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
            <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim, letterSpacing: "0.12em" }}>ROUND · PICK</div>
            <div style={{ fontFamily: v.monoFont, fontSize: 28, color: v.text, fontWeight: 700, letterSpacing: "-0.02em" }}>
              {MOCK.draftState.round} · <span style={{ color: v.textDim }}>{MOCK.draftState.pickNo}/{MOCK.draftState.totalPicks}</span>
            </div>
            <div style={{ display:"flex", gap: 6, marginTop: 6 }}>
              <Btn small primary={captainView} onClick={() => setCaptainView(!captainView)}>{captainView ? "队长视角 ✓" : "切到队长视角"}</Btn>
            </div>
          </div>
        </div>
      </Panel>

      {/* 8-team grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {MOCK.teams.map((t, i) => {
          const isCurrent = i === MOCK.draftState.pickingTeam;
          const roster = t.roster.slice(0, 4 - (i % 2));
          return (
            <div key={t.id} style={{
              padding: 12,
              background: isCurrent ? t.color + "0a" : v.panel,
              border: `${isCurrent ? 2 : 1}px solid ${isCurrent ? t.color : v.border}`,
              borderRadius: v.rmd,
              position: "relative",
              transition: "all 200ms",
            }}>
              {isCurrent && (
                <div style={{ position: "absolute", top: -1, left: -1, padding: "2px 6px", background: t.color, color: "#0a0c10", fontFamily: v.monoFont, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", borderRadius: `${v.rmd}px 0 ${v.rmd}px 0` }}>ON CLOCK</div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <TeamBadge team={t} size={32} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: v.displayFont, fontWeight: v.displayWeight, fontSize: 13, color: v.text, letterSpacing: "0.02em" }}>{t.name}</div>
                  <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim }}>SEED #{t.seed}</div>
                </div>
                <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid }}>{roster.length}/7</div>
              </div>
              <div style={{ display:"grid", gap: 4 }}>
                {roster.map((p) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                    <PosChip pos={p.pos} small />
                    <span style={{ color: v.text, fontFamily: v.bodyFont, fontWeight: 500 }}>{p.tag}</span>
                    {p.isCaptain && <span style={{ color: v.accent, fontFamily: v.monoFont, fontSize: 9, fontWeight: 700 }}>★C</span>}
                  </div>
                ))}
                {Array.from({ length: 7 - roster.length }).map((_, ii) => (
                  <div key={ii} style={{ height: 16, borderTop: `1px dashed ${v.border}`, marginTop: 4 }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
        {/* player pool */}
        <Panel pad={0}>
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${v.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", gap: 10 }}>
            <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid, letterSpacing: "0.12em", fontWeight: 700 }}>剩余选手池 · {remaining.length}</div>
            <div style={{ display: "flex", gap: 4 }}>
              {["ALL", ...MOCK.positions].map((p) => (
                <button key={p} onClick={() => setFilter(p)} style={{
                  padding: "4px 10px",
                  background: filter === p ? v.accent : "transparent",
                  border: `1px solid ${filter === p ? v.accent : v.border}`,
                  color: filter === p ? "#0a0c10" : v.textMid,
                  fontFamily: v.monoFont, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                  borderRadius: v.rsm, cursor: "pointer",
                }}>{p}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
            {pool.map((p, i) => (
              <button
                key={p.id}
                onClick={() => captainView && setPicked((s) => new Set([...s, p.id]))}
                disabled={!captainView}
                style={{
                  padding: "10px 12px",
                  borderRight: (i + 1) % 3 === 0 ? "none" : `1px solid ${v.border}`,
                  borderBottom: `1px solid ${v.border}`,
                  background: captainView ? v.panelLow : "transparent",
                  cursor: captainView ? "pointer" : "default",
                  display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center",
                  textAlign: "left", transition: "all 120ms",
                }}
                onMouseEnter={(e) => { if (captainView) e.currentTarget.style.background = v.accent + "15"; }}
                onMouseLeave={(e) => { if (captainView) e.currentTarget.style.background = v.panelLow; }}
              >
                <Avatar name={p.tag} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text, fontSize: 13 }}>{p.tag}</div>
                  <div style={{ display:"flex", gap:6, alignItems:"center", marginTop: 4 }}>
                    <PosChip pos={p.pos} small />
                    <span style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim }}>R {p.peakRating}</span>
                  </div>
                </div>
                {captainView && <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.accent }}>+ PICK</div>}
              </button>
            ))}
          </div>
        </Panel>

        {/* live log */}
        <Panel pad={0}>
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${v.border}`, fontFamily: v.monoFont, fontSize: 11, color: v.textMid, letterSpacing: "0.12em", fontWeight: 700 }}>PICK LOG</div>
          <div style={{ maxHeight: 380, overflow: "auto" }}>
            {[...MOCK.draftState.log].reverse().map((p, i) => {
              const team = MOCK.teams[p.team];
              return (
                <div key={i} style={{ padding: "10px 14px", borderBottom: `1px solid ${v.border}`, display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center" }}>
                  <TeamBadge team={team} size={28} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text, fontSize: 13 }}>{p.player}</div>
                    <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim }}>
                      <span style={{ color: team.color }}>{team.tag}</span> · {p.pos}
                    </div>
                  </div>
                  <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim }}>{p.t}</div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}

window.DraftScreen = DraftScreen;
