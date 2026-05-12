/* global React, MOCK, useVariant */
const { useState: useStateScr, useEffect: useEffectScr, useMemo: useMemoScr } = React;

/* =========================================================================
   LANDING (/)
   ========================================================================= */
function LandingScreen({ go }) {
  const v = useVariant();
  return (
    <div style={{ padding: "32px 36px", display: "grid", gap: 28 }}>
      {/* hero */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 24, alignItems: "stretch" }}>
        <Panel pad={0} style={{ overflow: "hidden", position: "relative" }}>
          <div style={{ padding: "28px 28px 32px", position: "relative", zIndex: 1 }}>
            <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.accent, letterSpacing: "0.2em", marginBottom: 12 }}>
              [ RIVALHUB / S4 — SPRING 2026 ]
            </div>
            <h1 style={{
              fontFamily: v.displayFont, fontWeight: v.displayWeight,
              fontSize: 56, lineHeight: 0.95, letterSpacing: v.displayTracking,
              textTransform: v.displayTransform, margin: 0, color: v.text,
            }}>
              NJU RIVALS<br/>
              <span style={{ color: v.accent }}>SPRING SPLIT</span>
            </h1>
            <div style={{ color: v.textMid, fontSize: 14, marginTop: 14, maxWidth: 520, lineHeight: 1.55 }}>
              8 队选秀联赛 · 蛇形选秀 · 单循环排位赛 + 双败淘汰 · BO3 决赛 BO5。校园电竞最高规格运营，全流程透明实时。
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
              <Btn primary onClick={() => go("season")}>进入赛季 →</Btn>
              <Btn onClick={() => go("register")}>报名参赛</Btn>
              <Btn ghost onClick={() => go("draft")}>观看选秀直播</Btn>
            </div>
            <Slash style={{ marginTop: 26 }} />
          </div>
          <div aria-hidden style={{
            position: "absolute", inset: 0, opacity: 0.5,
            background: `
              radial-gradient(circle at 90% 10%, ${v.accent}22 0, transparent 40%),
              linear-gradient(90deg, transparent 0, transparent calc(100% - 1px), ${v.border} calc(100% - 1px)),
              repeating-linear-gradient(0deg, transparent 0 32px, ${v.border}40 32px 33px)
            `,
          }} />
        </Panel>

        <Panel label="LIVE NOW">
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim, letterSpacing: "0.1em" }}>ROUND 3 / PICK 18 OF 56</div>
              <div style={{ fontFamily: v.displayFont, fontSize: 20, fontWeight: v.displayWeight, color: v.text, marginTop: 4 }}>
                选秀进行中
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {MOCK.teams.slice(0, 6).map((t) => (
                <TeamBadge key={t.id} team={t} size={42} />
              ))}
            </div>
            <Bar pct={32} />
            <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid }}>
              当前: <span style={{ color: MOCK.teams[2].color, fontWeight: 700 }}>{MOCK.teams[2].name}</span> · 倒计时 <span style={{ color: v.accent }}>01:27</span>
            </div>
            <Btn full onClick={() => go("draft")}>打开直播间 →</Btn>
          </div>
        </Panel>
      </div>

      {/* nav tiles */}
      <div>
        <Marker num={1} sub="NAVIGATION">入口</Marker>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[
            { k: "register", t: "REGISTER", c: "报名", m: "07:30 截止" },
            { k: "captains", t: "CAPTAINS", c: "队长投票", m: "实时票数" },
            { k: "draft", t: "DRAFT ROOM", c: "选秀直播间", m: "● LIVE" },
            { k: "teams", t: "TEAMS", c: "8 支战队", m: "8 / 8" },
            { k: "matches", t: "MATCHES", c: "赛程", m: "28 场" },
            { k: "stats", t: "STATS", c: "数据排行", m: "Rating · ADR" },
            { k: "team", t: "TEAM DETAIL", c: "战队详情", m: "VOID · #1" },
            { k: "match", t: "MATCH", c: "比赛详情", m: "VOID vs MERIDIAN" },
          ].map((tile) => (
            <button key={tile.k} onClick={() => go(tile.k)} style={{
              cursor: "pointer", textAlign: "left",
              padding: 16, background: v.panel,
              border: `1px solid ${v.border}`, borderRadius: v.rmd,
              transition: "all 120ms ease",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = v.accent; e.currentTarget.style.background = v.panelHi; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = v.border; e.currentTarget.style.background = v.panel; }}
            >
              <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.accent, letterSpacing: "0.14em" }}>{tile.t}</div>
              <div style={{ fontFamily: v.displayFont, fontWeight: v.displayWeight, fontSize: 16, color: v.text, marginTop: 6 }}>{tile.c}</div>
              <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim, marginTop: 8 }}>{tile.m}</div>
            </button>
          ))}
        </div>
      </div>

      {/* archive */}
      <div>
        <Marker num={2} sub="ARCHIVE">历届赛季</Marker>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap: 12 }}>
          {[
            { y: "S3", n: "2025 秋季公开赛", w: "VOID", s: "ARCHIVED" },
            { y: "S2", n: "2025 春季选秀联赛", w: "MERIDIAN", s: "ARCHIVED" },
            { y: "S1", n: "2024 创立赛", w: "ASCEND", s: "ARCHIVED" },
          ].map((s) => (
            <div key={s.y} style={{
              padding: 16, background: v.panel,
              border: `1px solid ${v.border}`, borderRadius: v.rmd,
              display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "center",
            }}>
              <div style={{ fontFamily: v.monoFont, fontSize: 24, fontWeight: 700, color: v.textDim }}>{s.y}</div>
              <div>
                <div style={{ fontFamily: v.bodyFont, fontWeight: 600, fontSize: 14, color: v.text }}>{s.n}</div>
                <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid, marginTop: 4 }}>冠军 · <span style={{ color: v.accent }}>{s.w}</span></div>
              </div>
              <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim, letterSpacing: "0.1em" }}>{s.s}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   SEASON HOME (/[seasonSlug])
   ========================================================================= */
function SeasonHomeScreen({ go }) {
  const v = useVariant();
  const phases = [
    { k: "register", t: "REGISTER", done: true },
    { k: "vote", t: "VOTE", done: true },
    { k: "draft", t: "DRAFT", done: false, current: true },
    { k: "qualifiers", t: "REGULAR", done: false },
    { k: "playoffs", t: "PLAYOFFS", done: false },
    { k: "finals", t: "FINALS", done: false },
  ];

  return (
    <div style={{ padding: "32px 36px", display: "grid", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.accent, letterSpacing: "0.2em" }}>
            [ SEASON 04 · SPRING 2026 ]
          </div>
          <h1 style={{
            fontFamily: v.displayFont, fontWeight: v.displayWeight,
            fontSize: 42, margin: "6px 0 0", color: v.text,
            letterSpacing: v.displayTracking, textTransform: v.displayTransform,
          }}>NJU RIVALS · 春季选秀联赛</h1>
          <div style={{ color: v.textMid, fontSize: 13, marginTop: 8 }}>
            05.13 – 06.21 · 8 队 · 56 选手 · 单循环 + 双败 · 全国线下决赛
          </div>
        </div>
        <StatusPill status="drafting" />
      </div>

      {/* phase tracker */}
      <Panel pad={0}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)" }}>
          {phases.map((p, i) => (
            <div key={p.k} style={{
              padding: "18px 16px",
              borderRight: i < phases.length - 1 ? `1px solid ${v.border}` : "none",
              position: "relative",
              background: p.current ? v.panelHi : "transparent",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{
                  width: 16, height: 16,
                  border: `1px solid ${p.done ? v.ok : p.current ? v.accent : v.border}`,
                  background: p.done ? v.ok + "22" : p.current ? v.accent + "22" : "transparent",
                  borderRadius: v.rsm,
                  display: "grid", placeItems: "center",
                  fontFamily: v.monoFont, fontSize: 10,
                  color: p.done ? v.ok : p.current ? v.accent : v.textDim,
                  fontWeight: 700,
                }}>{p.done ? "✓" : i + 1}</div>
                <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim, letterSpacing: "0.1em" }}>STEP {i+1}</div>
              </div>
              <div style={{
                fontFamily: v.displayFont, fontSize: 14, fontWeight: v.displayWeight,
                color: p.done ? v.text : p.current ? v.accent : v.textMid,
                letterSpacing: "0.04em",
              }}>{p.t}</div>
            </div>
          ))}
        </div>
      </Panel>

      {/* feature grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16 }}>
        <Panel label={<><span>NEXT MATCHES</span><span style={{ color: v.accent }}>VIEW BRACKET →</span></>}>
          <div style={{ display: "grid", gap: 8 }}>
            {MOCK.matches.slice(13, 17).map((m) => (
              <button key={m.id} onClick={() => go("match")} style={{
                cursor: "pointer", textAlign: "left",
                display: "grid", gridTemplateColumns: "70px 1fr 1fr auto", alignItems: "center", gap: 12,
                padding: "10px 12px", background: v.panelLow,
                border: `1px solid ${v.border}`, borderRadius: v.rsm,
              }}>
                <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim }}>{m.scheduledAt}<br/><span style={{ color: v.textMid }}>{m.time}</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <TeamBadge team={m.ta} size={28} />
                  <span style={{ fontWeight: 600, color: v.text, fontSize: 13 }}>{m.ta.name}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <TeamBadge team={m.tb} size={28} />
                  <span style={{ fontWeight: 600, color: v.text, fontSize: 13 }}>{m.tb.name}</span>
                </div>
                <StatusPill status={m.status} />
              </button>
            ))}
          </div>
        </Panel>

        <Panel label="STANDINGS · TOP 4">
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: v.monoFont, fontSize: 12 }}>
            <thead>
              <tr style={{ color: v.textDim }}>
                <th style={{ textAlign: "left", padding: "4px 0", letterSpacing: "0.1em", fontWeight: 600 }}>#</th>
                <th style={{ textAlign: "left", padding: "4px 0", fontWeight: 600 }}>TEAM</th>
                <th style={{ textAlign: "right", padding: "4px 0", fontWeight: 600 }}>W-L</th>
                <th style={{ textAlign: "right", padding: "4px 0", fontWeight: 600 }}>Δ</th>
              </tr>
            </thead>
            <tbody>
              {MOCK.standings.slice(0, 4).map((t, i) => (
                <tr key={t.id} style={{ borderTop: `1px solid ${v.border}` }}>
                  <td style={{ padding: "8px 0", color: i === 0 ? v.accent : v.textMid, fontWeight: 700 }}>{String(t.rank).padStart(2, "0")}</td>
                  <td style={{ padding: "8px 0", display: "flex", alignItems: "center", gap: 8 }}>
                    <TeamBadge team={t} size={22} />
                    <span style={{ color: v.text, fontFamily: v.bodyFont, fontWeight: 600, fontSize: 13 }}>{t.name}</span>
                  </td>
                  <td style={{ padding: "8px 0", textAlign: "right", color: v.text }}>{t.maps_w}-{t.maps_l}</td>
                  <td style={{ padding: "8px 0", textAlign: "right", color: t.rounds_diff > 0 ? v.ok : v.danger }}>{t.rounds_diff > 0 ? "+" : ""}{t.rounds_diff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <Stat label="队伍" value="8" sub="ALL CONFIRMED" />
        <Stat label="选手" value="56" sub="42 STARTERS · 14 SUBS" />
        <Stat label="比赛" value="28" sub="14 PLAYED · 14 LEFT" />
        <Stat label="奖金池" value="¥45K" accent sub="+ MERCH · INVITES" />
      </div>
    </div>
  );
}

window.LandingScreen = LandingScreen;
window.SeasonHomeScreen = SeasonHomeScreen;
