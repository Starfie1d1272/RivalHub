/* global React, MOCK, useVariant */

/* =========================================================================
   STATS LEADERBOARD (/[seasonSlug]/stats)
   ========================================================================= */
function StatsScreen() {
  const v = useVariant();
  const [sort, setSort] = React.useState("hltv");
  const [posF, setPosF] = React.useState("ALL");

  const cols = [
    { k: "hltv", label: "RATING" },
    { k: "adr", label: "ADR" },
    { k: "kd", label: "K-D" },
    { k: "we", label: "W%" },
    { k: "kpr", label: "KPR" },
  ];

  const rows = MOCK.players
    .filter((p) => posF === "ALL" || p.pos === posF)
    .sort((a, b) => b[sort] - a[sort])
    .slice(0, 18);

  return (
    <div style={{ padding: "32px 36px" }}>
      <Marker num={6} sub="LEADERBOARDS · S04" action={
        <div style={{ display:"flex", gap: 4 }}>
          {["ALL", ...MOCK.positions].map((p) => (
            <button key={p} onClick={() => setPosF(p)} style={{
              padding: "5px 10px", background: posF === p ? v.accent : "transparent",
              border: `1px solid ${posF === p ? v.accent : v.border}`,
              color: posF === p ? "#0a0c10" : v.textMid,
              fontFamily: v.monoFont, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
              borderRadius: v.rsm, cursor: "pointer",
            }}>{p}</button>
          ))}
        </div>
      }>选手数据排行</Marker>

      <Panel pad={0}>
        <div style={{ display:"grid", gridTemplateColumns:"50px 1fr 80px 80px " + cols.map(()=>"80px").join(" ") + " 60px", padding: "10px 16px", borderBottom: `1px solid ${v.border}`, fontFamily: v.monoFont, fontSize: 10, color: v.textDim, letterSpacing: "0.12em" }}>
          <div>#</div><div>PLAYER</div><div>TEAM</div><div>POS</div>
          {cols.map((c) => (
            <button key={c.k} onClick={() => setSort(c.k)} style={{
              background:"transparent", border:"none", cursor:"pointer",
              fontFamily: v.monoFont, fontSize: 10, fontWeight: sort === c.k ? 700 : 600,
              color: sort === c.k ? v.accent : v.textDim, letterSpacing: "0.12em", textAlign: "right",
            }}>{c.label}{sort === c.k ? " ↓" : ""}</button>
          ))}
          <div style={{textAlign:"right"}}>MAPS</div>
        </div>

        {rows.map((p, i) => (
          <div key={p.id} style={{
            display:"grid",
            gridTemplateColumns:"50px 1fr 80px 80px " + cols.map(()=>"80px").join(" ") + " 60px",
            padding: "10px 16px",
            borderBottom: `1px solid ${v.border}`,
            background: i < 3 ? v.accent + "06" : i % 2 ? v.rowAltBg : "transparent",
            alignItems: "center",
          }}>
            <div style={{ fontFamily: v.monoFont, fontWeight: 700, color: i < 3 ? v.accent : v.textMid }}>{String(i+1).padStart(2,"0")}</div>
            <div style={{ display:"flex", alignItems:"center", gap: 10 }}>
              <Avatar name={p.tag} size={28} />
              <div>
                <div style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text, fontSize: 13 }}>{p.tag}</div>
                <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim }}>{p.name}</div>
              </div>
            </div>
            <div><TeamBadge team={MOCK.teams[p.teamIdx]} size={24} /></div>
            <div><PosChip pos={p.pos} small /></div>
            {cols.map((c) => (
              <div key={c.k} style={{ textAlign:"right", fontFamily: v.monoFont, fontWeight: sort === c.k ? 700 : 500, color: sort === c.k ? v.accent : v.text, fontSize: 13 }}>
                {c.k === "we" ? Math.round(p.we * 100) + "%" :
                 c.k === "adr" ? Math.round(p.adr) :
                 c.k === "kd" || c.k === "kpr" ? p[c.k].toFixed(2) :
                 p[c.k].toFixed(2)}
              </div>
            ))}
            <div style={{ textAlign:"right", fontFamily: v.monoFont, fontSize: 12, color: v.textMid }}>{6 + (i % 8)}</div>
          </div>
        ))}
      </Panel>
    </div>
  );
}

/* =========================================================================
   ADMIN OVERVIEW
   ========================================================================= */
function AdminScreen() {
  const v = useVariant();
  const queue = [
    { name: "k1ngd0m", email: "lin.w@nju.edu.cn", pos: "IGL", rating: 9420, status: "pending" },
    { name: "ph4se", email: "wei.h@nju.edu.cn", pos: "AWP", rating: 9180, status: "pending" },
    { name: "spectr", email: "hao.y@nju.edu.cn", pos: "LURK", rating: 8950, status: "pending" },
    { name: "valor", email: "yan.c@nju.edu.cn", pos: "ENTRY", rating: 8770, status: "pending" },
    { name: "ember", email: "chen.b@nju.edu.cn", pos: "SUPPORT", rating: 8410, status: "approved" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", minHeight: "100%" }}>
      {/* admin sidebar */}
      <div style={{ background: v.panelLow, borderRight: `1px solid ${v.border}`, padding: "20px 0" }}>
        <div style={{ padding: "0 20px 16px", fontFamily: v.monoFont, fontSize: 10, color: v.accent, letterSpacing: "0.18em", fontWeight: 700 }}>[ ADMIN ]</div>
        {[
          { k: "dash", t: "概览", active: true },
          { k: "reg", t: "报名审核", badge: 23 },
          { k: "cap", t: "队长名单" },
          { k: "draft", t: "选秀控制" },
          { k: "match", t: "赛程录分" },
          { k: "users", t: "用户管理" },
          { k: "audit", t: "审计日志" },
          { k: "settings", t: "赛季配置" },
        ].map((it) => (
          <div key={it.k} style={{
            padding: "10px 20px",
            background: it.active ? v.panel : "transparent",
            borderLeft: `2px solid ${it.active ? v.accent : "transparent"}`,
            display: "flex", justifyContent: "space-between", alignItems: "center",
            cursor: "pointer", fontFamily: v.bodyFont, fontWeight: it.active ? 600 : 500,
            color: it.active ? v.text : v.textMid, fontSize: 13,
          }}>
            <span>{it.t}</span>
            {it.badge && <span style={{ background: v.accent, color: "#0a0c10", fontFamily: v.monoFont, fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999 }}>{it.badge}</span>}
          </div>
        ))}
      </div>

      <div style={{ padding: "24px 28px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim, letterSpacing: "0.16em" }}>ADMIN · SPRING 2026</div>
            <h1 style={{ fontFamily: v.displayFont, fontSize: 28, fontWeight: v.displayWeight, margin: "4px 0 0", color: v.text }}>赛季控制台</h1>
          </div>
          <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid }}>
            登录 · <span style={{ color: v.accent }}>RivalHub_root</span>
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
          <Stat label="待审核报名" value="23" accent sub="↑ 6 SINCE 12:00" />
          <Stat label="已通过" value="48" sub="OF 56 SLOTS" />
          <Stat label="当前阶段" value="DRAFT" sub="ROUND 3 / 8" />
          <Stat label="审计日志" value="1,284" sub="LAST 7D" />
        </div>

        <Panel label={<><span>报名审核队列</span><span style={{ display:"flex", gap: 6 }}><Btn small ghost>导出 CSV</Btn><Btn small primary>批量通过</Btn></span></>} pad={0}>
          <div style={{ display:"grid", gridTemplateColumns:"40px 1fr 1fr 100px 100px 100px 220px", padding: "10px 16px", borderBottom:`1px solid ${v.border}`, fontFamily: v.monoFont, fontSize: 10, color: v.textDim, letterSpacing: "0.12em" }}>
            <div></div><div>PLAYER</div><div>EMAIL</div><div>POS</div><div style={{textAlign:"right"}}>RATING</div><div>SCREENS</div><div style={{textAlign:"right"}}>ACTIONS</div>
          </div>
          {queue.map((r, i) => (
            <div key={i} style={{ display:"grid", gridTemplateColumns:"40px 1fr 1fr 100px 100px 100px 220px", padding: "12px 16px", borderBottom: i < queue.length - 1 ? `1px solid ${v.border}` : "none", alignItems: "center" }}>
              <input type="checkbox" />
              <div style={{ display:"flex", alignItems:"center", gap: 10 }}>
                <Avatar name={r.name} size={28} />
                <span style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text }}>{r.name}</span>
              </div>
              <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid }}>{r.email}</div>
              <div><PosChip pos={r.pos} small /></div>
              <div style={{ textAlign:"right", fontFamily: v.monoFont, fontWeight: 700, color: v.text }}>{r.rating}</div>
              <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.accent, cursor: "pointer" }}>3 imgs ↗</div>
              <div style={{ display:"flex", gap: 4, justifyContent: "flex-end" }}>
                {r.status === "pending" ? (
                  <>
                    <Btn small primary>通过</Btn>
                    <Btn small>等待</Btn>
                    <Btn small danger>拒绝</Btn>
                  </>
                ) : <StatusPill status="open" />}
              </div>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}

window.StatsScreen = StatsScreen;
window.AdminScreen = AdminScreen;
