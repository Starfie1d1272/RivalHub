/* global React, MOCK, useVariant */

/* =========================================================================
   PLAYER PROFILE (/players/[userId]) — cross-season aggregation
   ========================================================================= */
function PlayerProfileScreen({ go }) {
  const v = useVariant();
  const p = MOCK.players[0];
  const team = MOCK.teams[p.teamIdx];
  const [tab, setTab] = React.useState("overview");

  const seasonHistory = [
    { id: "S4", name: "2026 Spring · NJU Rivals", team: "VOID", role: "CAPTAIN", maps: 18, rating: 1.28, adr: 92, kd: 1.31, hi: true },
    { id: "S3", name: "2025 Autumn · NJU Major", team: "MERIDIAN", role: "IGL", maps: 14, rating: 1.18, adr: 84, kd: 1.18 },
    { id: "S2", name: "2025 Spring · NJU Rivals", team: "ASCEND", role: "ENTRY → IGL", maps: 16, rating: 1.14, adr: 81, kd: 1.12 },
    { id: "S1", name: "2024 Founding Cup", team: "PARALLAX", role: "ENTRY", maps: 9, rating: 1.02, adr: 73, kd: 0.97 },
  ];

  // Mock rating timeline (24 maps)
  const timeline = Array.from({ length: 24 }, (_, i) => 0.85 + Math.sin(i * 0.6) * 0.18 + i * 0.012);
  const maxR = Math.max(...timeline);
  const minR = Math.min(...timeline);

  return (
    <div style={{ padding: "0 0 32px" }}>
      {/* hero */}
      <div style={{
        padding: "32px 36px",
        background: `linear-gradient(120deg, ${team.color}15 0%, transparent 50%)`,
        borderBottom: `1px solid ${v.border}`,
        display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 24, alignItems: "center",
      }}>
        <Avatar name={p.tag} size={96} />
        <div>
          <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.accent, letterSpacing: "0.18em" }}>[ PLAYER · ALL SEASONS ]</div>
          <h1 style={{ fontFamily: v.displayFont, fontWeight: v.displayWeight, fontSize: 56, margin: "4px 0 6px", color: v.text, letterSpacing: v.displayTracking }}>
            {p.tag}
          </h1>
          <div style={{ display: "flex", gap: 12, fontFamily: v.monoFont, fontSize: 12, color: v.textMid, alignItems: "center" }}>
            <span>{p.name}</span>
            <span>·</span>
            <TeamBadge team={team} size={22} />
            <span style={{ color: team.color, fontWeight: 700 }}>{team.name}</span>
            <span>·</span>
            <PosChip pos={p.pos} small />
            <span>·</span>
            <span>★ CAPTAIN</span>
            <span>·</span>
            <span>Steam · 76561198xxxxxxxxx</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn onClick={() => go("team")}>战队</Btn>
          <Btn primary>关注</Btn>
        </div>
      </div>

      {/* tabs */}
      <div style={{ padding: "0 36px", borderBottom: `1px solid ${v.border}`, display: "flex", gap: 0 }}>
        {[["overview","概览"],["history","赛季履历"],["maps","比赛记录"],["awards","成就"]].map(([k, lab]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: "12px 18px", background: "transparent", border: "none",
            borderBottom: `2px solid ${tab === k ? v.accent : "transparent"}`,
            color: tab === k ? v.text : v.textMid, fontFamily: v.bodyFont, fontWeight: 600, fontSize: 13,
            cursor: "pointer",
          }}>{lab}</button>
        ))}
      </div>

      {tab === "overview" && (
        <div style={{ padding: "24px 36px", display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18 }}>
          <div style={{ display: "grid", gap: 18 }}>
            {/* career averages */}
            <Panel label="CAREER AVERAGES · WEIGHTED">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                <Stat label="RATING" value="1.21" accent sub="57 MAPS" />
                <Stat label="ADR" value="84.2" />
                <Stat label="K-D" value="1.17" />
                <Stat label="WIN%" value="68%" sub="39W · 18L" />
                <Stat label="KPR" value="0.79" />
              </div>
            </Panel>

            {/* rating timeline */}
            <Panel label="RATING TIMELINE · LAST 24 MAPS">
              <div style={{ position: "relative", height: 160, padding: "10px 0" }}>
                <svg width="100%" height="100%" viewBox={`0 0 ${(timeline.length - 1) * 30} 100`} preserveAspectRatio="none" style={{ display: "block" }}>
                  {/* baseline */}
                  <line x1="0" x2={(timeline.length - 1) * 30} y1="50" y2="50" stroke={v.border} strokeDasharray="4 4" />
                  {/* area */}
                  <path
                    d={`M 0 100 ${timeline.map((r, i) => `L ${i * 30} ${100 - ((r - minR) / (maxR - minR)) * 90 - 5}`).join(" ")} L ${(timeline.length - 1) * 30} 100 Z`}
                    fill={v.accent + "22"}
                  />
                  <path
                    d={`M ${timeline.map((r, i) => `${i * 30} ${100 - ((r - minR) / (maxR - minR)) * 90 - 5}`).join(" L ")}`}
                    fill="none" stroke={v.accent} strokeWidth="1.5"
                  />
                  {timeline.map((r, i) => (
                    <circle key={i} cx={i * 30} cy={100 - ((r - minR) / (maxR - minR)) * 90 - 5} r="2" fill={v.bg} stroke={v.accent} strokeWidth="1.2" />
                  ))}
                </svg>
                <div style={{ position: "absolute", left: 0, top: 0, fontFamily: v.monoFont, fontSize: 10, color: v.textDim }}>{maxR.toFixed(2)}</div>
                <div style={{ position: "absolute", left: 0, bottom: 0, fontFamily: v.monoFont, fontSize: 10, color: v.textDim }}>{minR.toFixed(2)}</div>
                <div style={{ position: "absolute", right: 0, top: 4, fontFamily: v.monoFont, fontSize: 10, color: v.accent, letterSpacing: "0.1em" }}>↑ TRENDING</div>
              </div>
            </Panel>

            {/* recent matches */}
            <Panel label="RECENT MATCHES" pad={0}>
              {MOCK.matches.slice(0, 5).map((m, i) => {
                const opp = m.tb;
                const won = m.score.a > m.score.b;
                return (
                  <button key={m.id} onClick={() => go("match")} style={{
                    width: "100%", textAlign: "left", cursor: "pointer", background: "transparent",
                    display: "grid", gridTemplateColumns: "60px auto 1fr 80px 80px 80px 80px auto", gap: 12, alignItems: "center",
                    padding: "12px 16px", borderTop: i ? `1px solid ${v.border}` : "none", border: "none",
                  }}>
                    <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim }}>{m.scheduledAt.slice(5)}</div>
                    <div style={{ width: 4, height: 28, background: won ? v.ok : v.danger }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim }}>vs</span>
                      <TeamBadge team={opp} size={24} />
                      <span style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text, fontSize: 13 }}>{opp.name}</span>
                    </div>
                    <div style={{ fontFamily: v.monoFont, fontSize: 13, fontWeight: 700, color: won ? v.ok : v.danger }}>{won ? "W" : "L"} {m.score.a}-{m.score.b}</div>
                    <MiniStat label="RAT" value={(1.1 + i * 0.04).toFixed(2)} accent />
                    <MiniStat label="ADR" value={Math.round(78 + i * 4)} />
                    <MiniStat label="K-D" value={(1.1 + i * 0.03).toFixed(2)} />
                    <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim }}>→</div>
                  </button>
                );
              })}
            </Panel>
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            {/* radar */}
            <Panel label="ROLE FIT · IGL">
              <PlayerRadar />
            </Panel>

            <Panel label="BEST MAPS">
              {[
                { name: "Inferno", w: 11, l: 3, r: 1.34 },
                { name: "Mirage", w: 8, l: 4, r: 1.22 },
                { name: "Nuke", w: 6, l: 5, r: 1.14 },
                { name: "Ancient", w: 4, l: 4, r: 1.02 },
              ].map((m, i) => (
                <div key={m.name} style={{ display: "grid", gridTemplateColumns: "1fr 60px 60px", gap: 8, alignItems: "center", padding: "8px 0", borderTop: i ? `1px solid ${v.border}` : "none" }}>
                  <div>
                    <div style={{ fontFamily: v.displayFont, fontWeight: 600, fontSize: 13, color: v.text }}>{m.name}</div>
                    <Bar pct={(m.w / (m.w + m.l)) * 100} />
                  </div>
                  <div style={{ textAlign: "right", fontFamily: v.monoFont, fontSize: 11, color: v.textMid }}>{m.w}-{m.l}</div>
                  <div style={{ textAlign: "right", fontFamily: v.monoFont, fontSize: 13, fontWeight: 700, color: v.accent }}>{m.r.toFixed(2)}</div>
                </div>
              ))}
            </Panel>

            <Panel label="AWARDS">
              <div style={{ display: "grid", gap: 10 }}>
                {[
                  { t: "S4 SPRING · TOP RATING", c: v.accent },
                  { t: "S3 AUTUMN · MVP FINALS", c: v.ok },
                  { t: "S2 SPRING · BEST IGL", c: v.warn },
                ].map((a, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 10, alignItems: "center", padding: "8px 10px", background: v.panelLow, border: `1px solid ${v.border}`, borderRadius: v.rsm }}>
                    <div style={{ width: 28, height: 28, background: a.c + "22", border: `1px solid ${a.c}55`, color: a.c, borderRadius: v.rsm, display: "grid", placeItems: "center", fontFamily: v.monoFont, fontWeight: 700 }}>★</div>
                    <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.text, letterSpacing: "0.06em" }}>{a.t}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {tab === "history" && (
        <div style={{ padding: "24px 36px" }}>
          <Panel pad={0}>
            <div style={{ display: "grid", gridTemplateColumns: "60px 1.5fr 1fr 1fr 80px 80px 80px 80px", padding: "10px 16px", borderBottom: `1px solid ${v.border}`, fontFamily: v.monoFont, fontSize: 10, color: v.textDim, letterSpacing: "0.12em" }}>
              <div>SEASON</div><div>EVENT</div><div>TEAM</div><div>ROLE</div>
              <div style={{ textAlign: "right" }}>MAPS</div>
              <div style={{ textAlign: "right" }}>RAT</div>
              <div style={{ textAlign: "right" }}>ADR</div>
              <div style={{ textAlign: "right" }}>K-D</div>
            </div>
            {seasonHistory.map((s, i) => (
              <div key={s.id} style={{ display: "grid", gridTemplateColumns: "60px 1.5fr 1fr 1fr 80px 80px 80px 80px", padding: "14px 16px", borderBottom: i < seasonHistory.length - 1 ? `1px solid ${v.border}` : "none", background: s.hi ? v.accent + "08" : "transparent", alignItems: "center" }}>
                <div style={{ fontFamily: v.monoFont, fontWeight: 700, color: s.hi ? v.accent : v.textMid }}>{s.id}</div>
                <div style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text }}>{s.name}</div>
                <div style={{ fontFamily: v.bodyFont, color: v.text }}>{s.team}</div>
                <div><PosChip pos={s.role} small /></div>
                <div style={{ textAlign: "right", fontFamily: v.monoFont, color: v.text }}>{s.maps}</div>
                <div style={{ textAlign: "right", fontFamily: v.monoFont, fontWeight: 700, color: v.accent }}>{s.rating.toFixed(2)}</div>
                <div style={{ textAlign: "right", fontFamily: v.monoFont, color: v.text }}>{s.adr.toFixed(1)}</div>
                <div style={{ textAlign: "right", fontFamily: v.monoFont, color: v.text }}>{s.kd.toFixed(2)}</div>
              </div>
            ))}
          </Panel>
        </div>
      )}

      {tab === "maps" && (
        <div style={{ padding: "24px 36px", color: v.textMid, fontFamily: v.monoFont, textAlign: "center", fontSize: 13 }}>
          <Panel>
            <div style={{ padding: 40 }}>
              <div style={{ fontSize: 24, color: v.textDim, marginBottom: 10 }}>◇</div>
              全部 57 张地图数据 · 暂未实现详细列表
            </div>
          </Panel>
        </div>
      )}

      {tab === "awards" && (
        <div style={{ padding: "24px 36px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {[
              { y: "2026", t: "S4 SPRING · TOP RATING", sub: "1.28 across 18 maps", c: v.accent },
              { y: "2025", t: "S3 AUTUMN · MVP GRAND FINAL", sub: "VOID 3-1 MERIDIAN", c: v.ok },
              { y: "2025", t: "S2 SPRING · BEST IGL", sub: "highest K-D among IGLs", c: v.warn },
              { y: "2024", t: "S1 FOUNDING · ALL-STAR 5", sub: "voted by 38 players", c: v.textMid },
            ].map((a, i) => (
              <div key={i} style={{ padding: 18, background: v.panel, border: `1px solid ${v.border}`, borderLeft: `3px solid ${a.c}`, borderRadius: v.rmd }}>
                <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim, letterSpacing: "0.12em" }}>{a.y}</div>
                <div style={{ fontFamily: v.displayFont, fontWeight: v.displayWeight, fontSize: 16, color: v.text, marginTop: 6 }}>{a.t}</div>
                <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid, marginTop: 4 }}>{a.sub}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerRadar() {
  const v = useVariant();
  const axes = ["FRAG", "ENTRY", "CLUTCH", "UTILITY", "ECON", "COMM"];
  const values = [0.78, 0.62, 0.85, 0.71, 0.68, 0.92];
  const cx = 110, cy = 100, r = 70;
  const points = values.map((val, i) => {
    const ang = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    return [cx + Math.cos(ang) * r * val, cy + Math.sin(ang) * r * val];
  });
  return (
    <svg viewBox="0 0 220 200" width="100%" style={{ display: "block" }}>
      {[0.25, 0.5, 0.75, 1].map((scale) => (
        <polygon key={scale}
          points={axes.map((_, i) => {
            const ang = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
            return `${cx + Math.cos(ang) * r * scale},${cy + Math.sin(ang) * r * scale}`;
          }).join(" ")}
          fill="none" stroke={v.border} strokeWidth="1"
        />
      ))}
      {axes.map((_, i) => {
        const ang = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
        return <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(ang) * r} y2={cy + Math.sin(ang) * r} stroke={v.border} strokeWidth="1" />;
      })}
      <polygon points={points.map((p) => p.join(",")).join(" ")} fill={v.accent + "33"} stroke={v.accent} strokeWidth="1.5" />
      {points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" fill={v.accent} />)}
      {axes.map((ax, i) => {
        const ang = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
        const lx = cx + Math.cos(ang) * (r + 14);
        const ly = cy + Math.sin(ang) * (r + 14);
        return <text key={ax} x={lx} y={ly} fill={v.textDim} fontSize="9" fontFamily={v.monoFont} textAnchor="middle" dominantBaseline="middle" letterSpacing="0.1em">{ax}</text>;
      })}
    </svg>
  );
}

/* =========================================================================
   LOGIN (/login)
   ========================================================================= */
function LoginScreen({ go }) {
  const v = useVariant();
  const [mode, setMode] = React.useState("magic");
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);

  return (
    <div style={{ minHeight: 760, display: "grid", placeItems: "center", padding: "40px 20px",
      background: `radial-gradient(circle at 50% 30%, ${v.accent}10 0, transparent 50%)`,
    }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{
            width: 56, height: 56, background: v.accent,
            display: "inline-grid", placeItems: "center",
            fontFamily: v.monoFont, fontWeight: 800, color: "#0a0c10", fontSize: 28,
            borderRadius: v.rsm,
            boxShadow: `0 0 32px ${v.accent}44`,
          }}>R</div>
          <h1 style={{ fontFamily: v.displayFont, fontWeight: v.displayWeight, fontSize: 28, color: v.text, margin: "16px 0 4px", letterSpacing: v.displayTracking }}>
            登录 RivalHub
          </h1>
          <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid, letterSpacing: "0.12em" }}>
            [ S04 · SPRING 2026 ]
          </div>
        </div>

        <Panel pad={24}>
          {/* mode tabs */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", marginBottom: 18, border: `1px solid ${v.border}`, borderRadius: v.rsm, overflow: "hidden" }}>
            {[["magic", "MAGIC LINK", "选手登录"], ["password", "PASSWORD", "管理员登录"]].map(([k, lab, sub]) => (
              <button key={k} onClick={() => { setMode(k); setSent(false); }} style={{
                padding: "10px 12px", background: mode === k ? v.accent : "transparent",
                color: mode === k ? "#0a0c10" : v.textMid, border: "none", cursor: "pointer", textAlign: "center",
                fontFamily: v.bodyFont, fontWeight: 600,
              }}>
                <div style={{ fontFamily: v.monoFont, fontSize: 10, letterSpacing: "0.14em" }}>{lab}</div>
                <div style={{ fontSize: 12, marginTop: 2 }}>{sub}</div>
              </button>
            ))}
          </div>

          {mode === "magic" && !sent && (
            <div style={{ display: "grid", gap: 14 }}>
              <Field label="NJU EMAIL" value={email} onChange={setEmail} mono placeholder="you@nju.edu.cn" />
              <Btn primary full onClick={() => setSent(true)} disabled={!email}>发送登录链接 →</Btn>
              <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim, textAlign: "center", lineHeight: 1.6 }}>
                我们会发一封一次性登录邮件 · 链接 15 分钟内有效
              </div>
            </div>
          )}

          {mode === "magic" && sent && (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{
                width: 56, height: 56, margin: "0 auto 12px",
                border: `1px solid ${v.ok}`, color: v.ok,
                borderRadius: v.rsm, display: "grid", placeItems: "center",
                fontSize: 26, fontWeight: 700,
              }}>✓</div>
              <div style={{ fontFamily: v.displayFont, fontWeight: 600, fontSize: 18, color: v.text }}>邮件已发送</div>
              <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid, margin: "8px 0 14px" }}>
                请检查 <span style={{ color: v.accent }}>{email}</span> 收件箱
              </div>
              <Btn ghost onClick={() => setSent(false)}>← 换一个邮箱</Btn>
            </div>
          )}

          {mode === "password" && (
            <div style={{ display: "grid", gap: 14 }}>
              <Field label="USERNAME" value="" onChange={()=>{}} mono placeholder="RivalHub_root" />
              <Field label="PASSWORD" value="" onChange={()=>{}} mono type="password" placeholder="••••••••" />
              <Btn primary full onClick={() => go("admin")}>登录后台 →</Btn>
              <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim, textAlign: "center", letterSpacing: "0.08em" }}>
                ⚠ 仅供根管理员紧急登录 · 普通管理员请用邀请码
              </div>
            </div>
          )}
        </Panel>

        <div style={{ display: "flex", justifyContent: "center", gap: 18, marginTop: 16, fontFamily: v.monoFont, fontSize: 11, color: v.textDim }}>
          <button onClick={() => go("invite")} style={{ background: "transparent", border: "none", color: v.accent, cursor: "pointer", fontFamily: v.monoFont, fontSize: 11 }}>有邀请码? →</button>
          <span>·</span>
          <span>GitHub OAuth (soon)</span>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   INVITE CODE (/invite?code=...)
   ========================================================================= */
function InviteScreen({ go }) {
  const v = useVariant();
  const [code, setCode] = React.useState("INVITE-S4-A8K2-MX9");
  const [step, setStep] = React.useState("show"); // show | success

  return (
    <div style={{ minHeight: 760, display: "grid", placeItems: "center", padding: "40px 20px" }}>
      <div style={{ width: "100%", maxWidth: 520 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.accent, letterSpacing: "0.2em" }}>[ ADMIN INVITATION ]</div>
          <h1 style={{ fontFamily: v.displayFont, fontWeight: v.displayWeight, fontSize: 32, color: v.text, margin: "8px 0", letterSpacing: v.displayTracking }}>
            激活管理员权限
          </h1>
          <div style={{ color: v.textMid, fontSize: 13 }}>
            兑换后你的账号将获得对应赛季的管理权限
          </div>
        </div>

        {step === "show" && (
          <Panel pad={24}>
            <Label>INVITATION CODE</Label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              style={{
                width: "100%", padding: "14px 16px", marginTop: 6,
                background: v.panelLow, border: `1px solid ${v.accent}55`,
                color: v.accent, fontFamily: v.monoFont, fontSize: 18, fontWeight: 700,
                letterSpacing: "0.16em", outline: "none", borderRadius: v.rsm,
              }}
            />
            <div style={{ marginTop: 18, padding: "14px 16px", background: v.panelLow, border: `1px solid ${v.border}`, borderRadius: v.rsm, display: "grid", gap: 10, fontFamily: v.monoFont, fontSize: 12 }}>
              <KV k="SCOPE" val={<span style={{ color: v.text }}>SPRING 2026 · S04</span>} />
              <KV k="GRANTED BY" val={<span style={{ color: v.text }}>RivalHub_root</span>} />
              <KV k="ROLE" val={<span style={{ color: v.accent, fontWeight: 700 }}>SEASON_ADMIN</span>} />
              <KV k="EXPIRES" val={<span style={{ color: v.text }}>2026-05-13 23:59 CST</span>} />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <Btn primary full onClick={() => setStep("success")}>兑换邀请码 →</Btn>
              <Btn ghost onClick={() => go("login")}>取消</Btn>
            </div>
          </Panel>
        )}

        {step === "success" && (
          <Panel pad={32}>
            <div style={{ textAlign: "center" }}>
              <div style={{
                width: 72, height: 72, margin: "0 auto 16px",
                background: v.ok + "1f", border: `1px solid ${v.ok}`, color: v.ok,
                borderRadius: v.rsm, display: "grid", placeItems: "center",
                fontSize: 32, fontWeight: 700,
              }}>✓</div>
              <div style={{ fontFamily: v.displayFont, fontWeight: v.displayWeight, fontSize: 22, color: v.text }}>权限激活成功</div>
              <div style={{ fontFamily: v.monoFont, fontSize: 12, color: v.textMid, margin: "10px 0 22px" }}>
                你现在是 <span style={{ color: v.accent }}>SPRING 2026</span> 的赛季管理员
              </div>
              <Btn primary onClick={() => go("admin")}>打开管理后台 →</Btn>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

window.PlayerProfileScreen = PlayerProfileScreen;
window.LoginScreen = LoginScreen;
window.InviteScreen = InviteScreen;
