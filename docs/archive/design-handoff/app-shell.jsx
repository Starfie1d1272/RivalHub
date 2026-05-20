/* global React, useVariant, MOCK */

// App shell: top nav, theme application, screen router. One per variant instance.

const SCREENS = [
  { k: "landing", label: "HOME", chinese: "首页" },
  { k: "season", label: "SEASON", chinese: "赛季" },
  { k: "register", label: "REGISTER", chinese: "报名" },
  { k: "captains", label: "VOTING", chinese: "投票" },
  { k: "draft", label: "DRAFT", chinese: "选秀", live: true },
  { k: "teams", label: "TEAMS", chinese: "战队" },
  { k: "team", label: "TEAM", chinese: "战队详情", hidden: true },
  { k: "matches", label: "MATCHES", chinese: "赛程" },
  { k: "match", label: "MATCH", chinese: "比赛详情", hidden: true },
  { k: "stats", label: "STATS", chinese: "数据" },
  { k: "admin", label: "ADMIN", chinese: "后台" },
  { k: "states", label: "STATES", chinese: "状态" },
  { k: "player", label: "PLAYER", chinese: "选手主页", hidden: true },
  { k: "login", label: "LOGIN", chinese: "登录", hidden: true },
  { k: "invite", label: "INVITE", chinese: "邀请码", hidden: true },
];

function AppShell({ variantId, accent, density = "medium", initial = "landing" }) {
  const variant = React.useMemo(() => buildVariant(variantId, accent), [variantId, accent]);
  const [screen, setScreen] = React.useState(initial);
  const v = variant;

  const go = (k) => setScreen(k);
  const cur = SCREENS.find((s) => s.k === screen) || SCREENS[0];

  // Hidden screen back behavior: if user lands on detail, we still allow nav
  const Screen = {
    landing: LandingScreen,
    season: SeasonHomeScreen,
    register: RegisterScreen,
    captains: CaptainsScreen,
    draft: DraftScreen,
    teams: TeamsScreen,
    team: TeamDetailScreen,
    matches: MatchesScreen,
    match: MatchDetailScreen,
    stats: StatsScreen,
    admin: AdminScreen,
    states: StatesScreen,
    player: PlayerProfileScreen,
    login: LoginScreen,
    invite: InviteScreen,
  }[screen] || LandingScreen;

  // ticker text for variant C
  const tickerItems = [
    "● LIVE · DRAFT R3 P18 · MERIDIAN ON CLOCK 01:27",
    "STANDINGS · #1 VOID 6-0 · #2 ASCEND 5-1",
    "TOP RATING · k1ngd0m 1.28 · valor 1.24 · ph4se 1.21",
    "MAJOR TICKETS · QUALIFIED VIA TOP 4",
    "ROSTER LOCK · 06.18 · SCRIM WEEK 06.15-17",
  ].join("    ◆    ");

  return (
    <VariantContext.Provider value={v}>
      <div style={{
        background: v.bg, color: v.text,
        fontFamily: v.bodyFont,
        minHeight: "100%",
        position: "relative",
        // subtle scanline texture per variant
        backgroundImage: v.id === "A"
          ? `linear-gradient(${v.border}40 1px, transparent 1px), linear-gradient(90deg, ${v.border}40 1px, transparent 1px)`
          : v.id === "B"
          ? `repeating-linear-gradient(45deg, transparent 0 28px, ${v.border}26 28px 29px)`
          : `radial-gradient(circle at 20% 0%, ${v.accent}10 0, transparent 35%), radial-gradient(circle at 100% 100%, ${v.border}60 0, transparent 40%)`,
        backgroundSize: v.id === "A" ? "32px 32px" : "auto",
      }}>
        {/* Top nav */}
        <header style={{
          padding: "12px 28px",
          background: v.panelLow + "e6",
          borderBottom: `1px solid ${v.border}`,
          display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 24, alignItems: "center",
          position: "sticky", top: 0, zIndex: 10,
          backdropFilter: "blur(8px)",
        }}>
          {/* logo */}
          <button onClick={() => go("landing")} style={{
            background: "transparent", border: "none", padding: 0, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{
              width: 28, height: 28,
              background: v.accent,
              clipPath: v.id === "B"
                ? "polygon(0 0, 100% 0, 100% 70%, 70% 100%, 0 100%)"
                : "polygon(0 0, 100% 0, 100% 100%, 0 100%)",
              display: "grid", placeItems: "center",
              fontFamily: v.monoFont, fontWeight: 800, color: "#0a0c10", fontSize: 16,
              borderRadius: v.rsm,
            }}>R</div>
            <div style={{
              fontFamily: v.displayFont, fontWeight: 700, fontSize: 16, color: v.text,
              letterSpacing: v.id === "B" ? "0.02em" : "-0.01em",
              textTransform: v.displayTransform,
            }}>RIVALHUB<span style={{ color: v.accent, fontFamily: v.monoFont, fontSize: 11, marginLeft: 6 }}>/S4</span></div>
          </button>

          {/* nav links */}
          <nav style={{ display: "flex", justifyContent: "center", gap: 2, flexWrap: "wrap" }}>
            {SCREENS.filter((s) => !s.hidden).map((s) => (
              <button key={s.k} onClick={() => go(s.k)} style={{
                background: cur.k === s.k ? v.panel : "transparent",
                border: `1px solid ${cur.k === s.k ? v.border : "transparent"}`,
                borderBottom: cur.k === s.k ? `1px solid ${v.accent}` : `1px solid transparent`,
                color: cur.k === s.k ? v.text : v.textMid,
                fontFamily: v.bodyFont, fontWeight: cur.k === s.k ? 600 : 500, fontSize: 12,
                padding: "6px 12px", cursor: "pointer", borderRadius: v.rsm,
                display: "flex", alignItems: "center", gap: 6,
                letterSpacing: v.id === "B" ? "0.06em" : "0",
                textTransform: v.id === "B" ? "uppercase" : "none",
              }}>
                <span>{s.chinese}</span>
                {s.live && <span style={{ width: 5, height: 5, borderRadius: 999, background: v.danger, boxShadow: `0 0 6px ${v.danger}` }} />}
              </button>
            ))}
          </nav>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid }}>
              <span style={{ color: v.accent }}>●</span> 1,247 online
            </div>
            <button onClick={() => go("login")} style={{
              background: "transparent", border: `1px solid ${v.border}`, color: v.textMid,
              fontFamily: v.monoFont, fontSize: 10, padding: "4px 8px", cursor: "pointer",
              borderRadius: v.rsm, letterSpacing: "0.1em",
            }}>LOGIN</button>
            <button onClick={() => go("player")} style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>
              <Avatar name="you" size={28} />
            </button>
          </div>
        </header>

        {/* ticker (variant C only) */}
        {v.id === "C" && (
          <div style={{
            background: v.panelHi, borderBottom: `1px solid ${v.border}`,
            overflow: "hidden", height: 28, position: "relative",
          }}>
            <div style={{
              position: "absolute", whiteSpace: "nowrap", height: "100%",
              display: "flex", alignItems: "center", gap: 0,
              fontFamily: v.monoFont, fontSize: 11, color: v.textMid, letterSpacing: "0.08em",
              animation: "ticker 60s linear infinite",
            }}>
              <span style={{ paddingRight: 80 }}>{tickerItems}</span>
              <span style={{ paddingRight: 80 }}>{tickerItems}</span>
            </div>
          </div>
        )}

        <main>
          <Screen go={go} />
        </main>

        <footer style={{
          padding: "20px 28px",
          marginTop: 32,
          borderTop: `1px solid ${v.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontFamily: v.monoFont, fontSize: 11, color: v.textDim, letterSpacing: "0.08em",
        }}>
          <div>RIVALHUB · OPEN SOURCE ESPORTS TOURNAMENT PLATFORM</div>
          <div style={{ display: "flex", gap: 14 }}>
            <span>GITHUB ↗</span>
            <span>RULES</span>
            <span>PRIVACY</span>
            <span style={{ color: v.accent }}>v4.0-{v.id}</span>
          </div>
        </footer>
      </div>
    </VariantContext.Provider>
  );
}

window.AppShell = AppShell;
window.SCREENS = SCREENS;
