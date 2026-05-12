/* global React, MOCK, useVariant */

/* =========================================================================
   REGISTER (/[seasonSlug]/register)
   ========================================================================= */
function RegisterScreen({ go }) {
  const v = useVariant();
  const [pos, setPos] = React.useState("AWP");
  const [pos2, setPos2] = React.useState("LURK");
  const [captain, setCaptain] = React.useState(false);
  const [agree, setAgree] = React.useState(false);
  const [rating, setRating] = React.useState(9200);
  const [email, setEmail] = React.useState("you@nju.edu.cn");
  const [steam, setSteam] = React.useState("76561198");
  const [qq, setQq] = React.useState("");

  const capacity = { IGL: [9, 15], AWP: [14, 15], ENTRY: [11, 15], LURK: [6, 15], SUPPORT: [12, 15] };

  return (
    <div style={{ padding: "32px 36px", display: "grid", gridTemplateColumns: "1fr 360px", gap: 24 }}>
      <div>
        <Marker num={1} sub="STEP 01 OF 01">报名 · NJU RIVALS S04</Marker>

        <div style={{ display:"grid", gap: 18 }}>
          <Panel label="位置实时容量">
            <div style={{ display: "grid", gap: 10 }}>
              {Object.entries(capacity).map(([p, [cur, max]]) => {
                const pct = (cur / max) * 100;
                const full = cur >= max;
                return (
                  <div key={p} style={{ display: "grid", gridTemplateColumns: "80px 1fr 80px", gap: 12, alignItems: "center" }}>
                    <div style={{ display:"flex", alignItems:"center", gap: 8 }}>
                      <PosChip pos={p} />
                    </div>
                    <Bar pct={pct} color={full ? v.danger : pct > 80 ? v.warn : v.accent} />
                    <div style={{ fontFamily: v.monoFont, fontSize: 11, textAlign: "right", color: full ? v.danger : v.textMid }}>
                      {cur} / {max} {full && "FULL"}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel label="基础信息">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="EMAIL · NJU" value={email} onChange={setEmail} />
              <Field label="STEAM64" value={steam} onChange={setSteam} mono />
              <Field label="QQ" value={qq} onChange={setQq} mono placeholder="可选" />
              <Field label="历史最高 RATING" value={rating} onChange={setRating} mono type="number" />
            </div>
          </Panel>

          <Panel label="位置 + 段位">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Select label="主选位置" value={pos} onChange={setPos} options={MOCK.positions} capacity={capacity} />
              <Select label="次选位置" value={pos2} onChange={setPos2} options={MOCK.positions} capacity={capacity} />
            </div>
            <div style={{ marginTop: 14 }}>
              <Label>完美平台战绩截图</Label>
              <div style={{
                marginTop: 6, padding: "20px 16px",
                border: `1px dashed ${v.border}`, borderRadius: v.rmd,
                background: v.panelLow,
                display: "flex", alignItems: "center", gap: 14,
              }}>
                <div style={{ width: 48, height: 48, border:`1px solid ${v.border}`, borderRadius: v.rsm, display:"grid", placeItems:"center", color: v.textDim, fontFamily: v.monoFont, fontSize: 18 }}>↑</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text, fontSize: 14 }}>拖拽或粘贴 NJUBox 链接</div>
                  <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid, marginTop: 4 }}>支持 png · jpg · webp · 至少 1 张</div>
                </div>
                <Btn small>选择文件</Btn>
              </div>
            </div>
          </Panel>

          <Panel label="意向 + 承诺">
            <CheckRow checked={captain} onChange={setCaptain} label="愿意担任队长" sub="进入队长投票池，可被全体选手投票" />
            <div style={{ height: 1, background: v.border, margin: "12px 0" }} />
            <CheckRow checked={agree} onChange={setAgree} label="承诺不代打、不使用外挂、遵守赛事规则" sub="违规将永久封禁参赛资格" />
          </Panel>

          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <Btn primary disabled={!agree}>提交报名 →</Btn>
            <Btn ghost>保存草稿</Btn>
            <div style={{ flex: 1 }} />
            <Btn ghost onClick={() => go("season")}>取消</Btn>
          </div>
        </div>
      </div>

      {/* sidebar summary */}
      <div style={{ position: "sticky", top: 20, alignSelf: "start" }}>
        <Panel label="预览">
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Avatar name={steam} size={48} />
            <div>
              <div style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text }}>{email.split("@")[0]}</div>
              <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid }}>{email}</div>
            </div>
          </div>
          <div style={{ display:"flex", gap: 6, marginTop: 14 }}>
            <PosChip pos={pos} />
            <span style={{ color: v.textDim, fontFamily: v.monoFont, fontSize: 11, alignSelf:"center" }}>/</span>
            <PosChip pos={pos2} />
            {captain && <span style={{
              padding: "2px 6px", border: `1px solid ${v.accent}`, color: v.accent,
              fontFamily: v.monoFont, fontSize: 10, fontWeight: 700, letterSpacing:"0.08em", borderRadius: v.rsm,
            }}>★ CAPTAIN</span>}
          </div>
          <div style={{ marginTop: 14, padding: "10px 12px", background: v.panelLow, border: `1px solid ${v.border}`, borderRadius: v.rsm }}>
            <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim, letterSpacing: "0.12em" }}>RATING</div>
            <div style={{ fontFamily: v.monoFont, fontSize: 24, fontWeight: 700, color: v.accent, marginTop: 4 }}>{rating}</div>
          </div>
        </Panel>

        <div style={{ marginTop: 16 }}>
          <Panel label="赛季时间线">
            <div style={{ display: "grid", gap: 12, fontFamily: v.monoFont, fontSize: 12 }}>
              {[
                { d: "05.01", t: "报名开放", done: true },
                { d: "05.13", t: "报名截止", done: true, hi: true },
                { d: "05.14", t: "队长投票", done: false },
                { d: "05.16", t: "蛇形选秀", done: false },
                { d: "05.18", t: "排位赛 W1", done: false },
                { d: "06.21", t: "总决赛", done: false },
              ].map((row, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "44px 1fr auto", gap: 10, alignItems: "center" }}>
                  <span style={{ color: row.hi ? v.accent : v.textDim }}>{row.d}</span>
                  <span style={{ color: row.done ? v.textMid : v.text, textDecoration: row.done ? "line-through" : "none" }}>{row.t}</span>
                  {row.done && <span style={{ color: v.ok, fontSize: 10 }}>✓</span>}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Label({ children }) {
  const v = useVariant();
  return <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textMid, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>{children}</div>;
}
function Field({ label, value, onChange, mono, placeholder, type = "text" }) {
  const v = useVariant();
  return (
    <div>
      <Label>{label}</Label>
      <input value={value} placeholder={placeholder} type={type} onChange={(e) => onChange(type === "number" ? +e.target.value : e.target.value)} style={{
        width: "100%", padding: "9px 12px",
        background: v.panelLow, border: `1px solid ${v.border}`, borderRadius: v.rsm,
        color: v.text, fontFamily: mono ? v.monoFont : v.bodyFont, fontSize: 13, outline: "none",
      }} />
    </div>
  );
}
function Select({ label, value, onChange, options, capacity }) {
  const v = useVariant();
  return (
    <div>
      <Label>{label}</Label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
        {options.map((opt) => {
          const full = capacity && capacity[opt] && capacity[opt][0] >= capacity[opt][1];
          const active = value === opt;
          return (
            <button key={opt} disabled={full && !active} onClick={() => onChange(opt)} style={{
              padding: "8px 6px", cursor: full ? "not-allowed" : "pointer",
              background: active ? v.accent : v.panelLow,
              border: `1px solid ${active ? v.accent : v.border}`,
              color: active ? "#0a0c10" : full ? v.textDim : v.text,
              borderRadius: v.rsm, fontFamily: v.monoFont, fontWeight: 700, fontSize: 11,
              letterSpacing: "0.06em",
              opacity: full && !active ? 0.4 : 1,
            }}>{opt}</button>
          );
        })}
      </div>
    </div>
  );
}
function CheckRow({ checked, onChange, label, sub }) {
  const v = useVariant();
  return (
    <button onClick={() => onChange(!checked)} style={{
      width: "100%", textAlign: "left", cursor: "pointer", background: "transparent", border: "none",
      display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, alignItems: "flex-start",
      padding: 0,
    }}>
      <div style={{
        width: 18, height: 18, marginTop: 2,
        border: `1px solid ${checked ? v.accent : v.border}`,
        background: checked ? v.accent : "transparent",
        borderRadius: v.rsm, display: "grid", placeItems: "center",
        color: "#0a0c10", fontWeight: 700, fontSize: 12,
      }}>{checked && "✓"}</div>
      <div>
        <div style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text, fontSize: 13 }}>{label}</div>
        {sub && <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid, marginTop: 4 }}>{sub}</div>}
      </div>
    </button>
  );
}

/* =========================================================================
   CAPTAINS VOTING (/[seasonSlug]/captains)
   ========================================================================= */
function CaptainsScreen({ go }) {
  const v = useVariant();
  const candidates = MOCK.players.slice(0, 14).map((p, i) => ({ ...p, votes: 28 - i + (i % 3) }));
  const [voted, setVoted] = React.useState(new Set([candidates[1].id, candidates[3].id]));
  const total = 3;
  const maxV = Math.max(...candidates.map((c) => c.votes));

  const toggle = (id) => {
    setVoted((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else if (next.size < total) next.add(id);
      return next;
    });
  };

  return (
    <div style={{ padding: "32px 36px", display: "grid", gridTemplateColumns: "1fr 320px", gap: 24 }}>
      <div>
        <Marker num={2} sub="VOTING · CLOSES 05.15 23:59">队长投票</Marker>
        <div style={{ color: v.textMid, fontSize: 13, marginBottom: 18, maxWidth: 640 }}>
          每人最多投 3 票。得票前 8 名进入队长池，按 draftOrder 蛇形选秀。点击候选人投票或撤回。
        </div>

        <Panel pad={0}>
          <div style={{ display:"grid", gridTemplateColumns:"40px 1fr 1fr 100px 60px 100px", padding: "10px 16px", borderBottom:`1px solid ${v.border}`, fontFamily: v.monoFont, fontSize: 10, color: v.textDim, letterSpacing:"0.12em" }}>
            <div>#</div><div>PLAYER</div><div>BAR</div><div style={{ textAlign:"right" }}>VOTES</div><div style={{ textAlign:"right" }}>POS</div><div style={{ textAlign:"right" }}>ACTION</div>
          </div>
          {candidates.sort((a, b) => b.votes - a.votes).map((c, i) => {
            const isVoted = voted.has(c.id);
            const top8 = i < 8;
            return (
              <div key={c.id} style={{
                display:"grid", gridTemplateColumns:"40px 1fr 1fr 100px 60px 100px",
                padding: "12px 16px", borderBottom: `1px solid ${v.border}`,
                background: top8 ? v.accent + "06" : "transparent",
                alignItems: "center",
              }}>
                <div style={{ fontFamily: v.monoFont, fontWeight: 700, color: top8 ? v.accent : v.textMid, fontSize: 13 }}>
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar name={c.tag} size={32} />
                  <div>
                    <div style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text, fontSize: 13 }}>{c.tag}</div>
                    <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim }}>R {c.peakRating}</div>
                  </div>
                </div>
                <div style={{ paddingRight: 16 }}>
                  <Bar pct={(c.votes / maxV) * 100} color={top8 ? v.accent : v.textDim} />
                </div>
                <div style={{ textAlign:"right", fontFamily: v.monoFont, fontWeight: 700, color: v.text, fontSize: 14 }}>{c.votes}</div>
                <div style={{ textAlign:"right" }}><PosChip pos={c.pos} small /></div>
                <div style={{ textAlign:"right" }}>
                  <Btn small primary={!isVoted} onClick={() => toggle(c.id)} disabled={!isVoted && voted.size >= total}>
                    {isVoted ? "撤回" : "+ 投票"}
                  </Btn>
                </div>
              </div>
            );
          })}
        </Panel>
      </div>

      <div style={{ position: "sticky", top: 20, alignSelf: "start" }}>
        <Panel label="我的投票">
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
            <div style={{ fontFamily: v.monoFont, fontSize: 42, fontWeight: 700, color: v.accent, letterSpacing: "-0.04em", lineHeight: 1 }}>{voted.size}</div>
            <div style={{ fontFamily: v.monoFont, fontSize: 14, color: v.textDim }}>/ {total}</div>
          </div>
          <div style={{ display:"grid", gap: 8 }}>
            {[...voted].map((id) => {
              const c = candidates.find((cc) => cc.id === id);
              if (!c) return null;
              return (
                <div key={id} style={{ display:"grid", gridTemplateColumns:"auto 1fr auto", gap:10, alignItems:"center", padding: 8, background: v.panelLow, border:`1px solid ${v.border}`, borderRadius: v.rsm }}>
                  <Avatar name={c.tag} size={28} />
                  <div style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text, fontSize: 13 }}>{c.tag}</div>
                  <button onClick={() => toggle(id)} style={{ background: "transparent", border: "none", color: v.danger, cursor: "pointer", fontFamily: v.monoFont, fontSize: 11 }}>×</button>
                </div>
              );
            })}
            {Array.from({ length: total - voted.size }).map((_, i) => (
              <div key={i} style={{ padding: "10px 12px", border:`1px dashed ${v.border}`, borderRadius: v.rsm, fontFamily: v.monoFont, fontSize: 11, color: v.textDim, textAlign:"center" }}>
                空位 {String(voted.size + i + 1).padStart(2, "0")}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, padding: 10, background: v.panelLow, borderRadius: v.rsm, fontFamily: v.monoFont, fontSize: 11, color: v.textMid, lineHeight: 1.6 }}>
            投票每 5 秒同步一次 · 截止时锁定 · 撤回后可改投
          </div>
        </Panel>
      </div>
    </div>
  );
}

window.RegisterScreen = RegisterScreen;
window.CaptainsScreen = CaptainsScreen;
