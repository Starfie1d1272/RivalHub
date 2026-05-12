/* global React, MOCK, useVariant */

/* =========================================================================
   MATCHES (bracket + list) + MATCH DETAIL
   ========================================================================= */
function MatchesScreen({ go }) {
  const v = useVariant();
  const [tab, setTab] = React.useState("bracket");

  // Build a simple 8-team single-elim bracket from standings
  const seeds = MOCK.standings.slice(0, 8);
  const qf = [
    [seeds[0], seeds[7]],
    [seeds[3], seeds[4]],
    [seeds[1], seeds[6]],
    [seeds[2], seeds[5]],
  ];
  const sf = [
    [qf[0][0], qf[1][0]],
    [qf[2][0], qf[3][0]],
  ];
  const fin = [sf[0][0], sf[1][0]];

  return (
    <div style={{ padding: "32px 36px" }}>
      <Marker num={5} sub="REGULAR + PLAYOFFS" action={
        <div style={{ display: "flex", gap: 4 }}>
          {[["bracket", "BRACKET"], ["list", "LIST"], ["calendar", "CALENDAR"]].map(([k, lab]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              padding: "6px 14px",
              background: tab === k ? v.accent : "transparent",
              border: `1px solid ${tab === k ? v.accent : v.border}`,
              color: tab === k ? "#0a0c10" : v.textMid,
              fontFamily: v.monoFont, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
              borderRadius: v.rsm, cursor: "pointer",
            }}>{lab}</button>
          ))}
        </div>
      }>赛程</Marker>

      {tab === "bracket" && (
        <Panel pad={24}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 32, alignItems: "center" }}>
            {/* QF */}
            <div style={{ display: "grid", gap: 12 }}>
              <BracketLabel>QUARTERFINALS · BO3</BracketLabel>
              {qf.map((pair, i) => (
                <BracketMatch key={i} a={pair[0]} b={pair[1]} aScore={2} bScore={i % 2} winner={pair[0]} onClick={() => go("match")} />
              ))}
            </div>
            <div style={{ display: "grid", gap: 32 }}>
              <BracketLabel>SEMIFINALS · BO3</BracketLabel>
              {sf.map((pair, i) => (
                <BracketMatch key={i} a={pair[0]} b={pair[1]} aScore={2} bScore={1} winner={pair[0]} onClick={() => go("match")} />
              ))}
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              <BracketLabel>GRAND FINAL · BO5</BracketLabel>
              <BracketMatch a={fin[0]} b={fin[1]} aScore={0} bScore={0} pending onClick={() => go("match")} />
              <div style={{
                padding: 14, border: `1px solid ${v.accent}`, borderRadius: v.rmd,
                background: v.accent + "0a",
                fontFamily: v.monoFont, fontSize: 11, color: v.accent, letterSpacing: "0.1em",
                textAlign: "center", fontWeight: 700,
              }}>
                🏆 CHAMPION · TBD · 06.21
              </div>
            </div>
          </div>
        </Panel>
      )}

      {tab === "list" && (
        <Panel pad={0}>
          <div style={{ display:"grid", gridTemplateColumns:"80px 100px 1fr 80px 1fr 100px 80px", padding: "10px 16px", borderBottom: `1px solid ${v.border}`, fontFamily: v.monoFont, fontSize: 10, color: v.textDim, letterSpacing: "0.12em" }}>
            <div>DATE</div><div>TIME</div><div>HOME</div><div style={{textAlign:"center"}}>SCORE</div><div>AWAY</div><div style={{textAlign:"right"}}>STATUS</div><div></div>
          </div>
          {MOCK.matches.slice(0, 16).map((m) => (
            <div key={m.id} style={{
              display:"grid", gridTemplateColumns:"80px 100px 1fr 80px 1fr 100px 80px",
              padding: "12px 16px", borderBottom: `1px solid ${v.border}`, alignItems: "center",
              background: m.status === "live" ? v.danger + "08" : "transparent",
            }}>
              <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid }}>{m.scheduledAt}</div>
              <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim }}>{m.time}</div>
              <div style={{ display:"flex", alignItems:"center", gap: 8 }}>
                <TeamBadge team={m.ta} size={26} />
                <span style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text, fontSize: 13 }}>{m.ta.name}</span>
              </div>
              <div style={{ textAlign:"center", fontFamily: v.monoFont, fontWeight: 700, fontSize: 16, color: m.status === "finished" ? v.text : v.textDim }}>
                {m.status !== "scheduled" ? `${m.score.a} - ${m.score.b}` : "—"}
              </div>
              <div style={{ display:"flex", alignItems:"center", gap: 8 }}>
                <TeamBadge team={m.tb} size={26} />
                <span style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text, fontSize: 13 }}>{m.tb.name}</span>
              </div>
              <div style={{ textAlign:"right" }}><StatusPill status={m.status} /></div>
              <div style={{ textAlign:"right" }}><Btn small ghost onClick={() => go("match")}>→</Btn></div>
            </div>
          ))}
        </Panel>
      )}

      {tab === "calendar" && (
        <Panel>
          <div style={{ display:"grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
            {["MON","TUE","WED","THU","FRI","SAT","SUN"].map((d) => (
              <div key={d} style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim, letterSpacing: "0.12em", padding: 4 }}>{d}</div>
            ))}
            {Array.from({ length: 28 }).map((_, i) => {
              const has = [2, 4, 9, 11, 16, 18, 23, 25].includes(i);
              return (
                <div key={i} style={{
                  aspectRatio: "1 / 0.9",
                  padding: 8,
                  background: v.panelLow, border: `1px solid ${v.border}`, borderRadius: v.rsm,
                  fontFamily: v.monoFont, fontSize: 11, color: v.textMid,
                  position: "relative",
                }}>
                  <div>{i + 1}</div>
                  {has && (
                    <div style={{ position:"absolute", left: 8, right: 8, bottom: 8, padding: "2px 4px", background: v.accent + "22", color: v.accent, fontFamily: v.monoFont, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", borderRadius: 2 }}>
                      2 MATCHES
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}

function BracketLabel({ children }) {
  const v = useVariant();
  return <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim, letterSpacing: "0.18em", textAlign: "center", paddingBottom: 8, borderBottom: `1px dashed ${v.border}` }}>{children}</div>;
}
function BracketMatch({ a, b, aScore, bScore, winner, pending, onClick }) {
  const v = useVariant();
  const Row = ({ t, score, isWinner }) => (
    <div style={{
      display:"grid", gridTemplateColumns:"auto 1fr auto", gap: 10, alignItems: "center",
      padding: "8px 10px",
      background: isWinner ? v.accent + "10" : "transparent",
      borderLeft: isWinner ? `2px solid ${v.accent}` : "2px solid transparent",
    }}>
      <TeamBadge team={t} size={22} />
      <span style={{ fontFamily: v.bodyFont, fontWeight: isWinner ? 700 : 500, color: isWinner ? v.text : v.textMid, fontSize: 13 }}>{t.name}</span>
      <span style={{ fontFamily: v.monoFont, fontWeight: 700, color: pending ? v.textDim : isWinner ? v.accent : v.textMid, fontSize: 14, minWidth: 16, textAlign: "right" }}>
        {pending ? "—" : score}
      </span>
    </div>
  );
  return (
    <button onClick={onClick} style={{
      cursor:"pointer", textAlign:"left", background: v.panel,
      border: `1px solid ${v.border}`, borderRadius: v.rmd, padding: 0, overflow: "hidden",
    }}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = v.accent}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = v.border}
    >
      <Row t={a} score={aScore} isWinner={winner === a && !pending} />
      <div style={{ height: 1, background: v.border }} />
      <Row t={b} score={bScore} isWinner={winner === b && !pending} />
    </button>
  );
}

function MatchDetailScreen({ go }) {
  const v = useVariant();
  const m = { ...MOCK.matches[14], status: "live", score: { a: 1, b: 0 } };
  const live = true;

  return (
    <div>
      {/* hero header */}
      <div style={{
        padding: "28px 36px",
        background: `linear-gradient(90deg, ${m.ta.color}18 0%, transparent 35%, transparent 65%, ${m.tb.color}18 100%)`,
        borderBottom: `1px solid ${v.border}`,
        display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 24, alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "flex-end" }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim, letterSpacing: "0.12em" }}>SEED #{m.ta.seed}</div>
            <div style={{ fontFamily: v.displayFont, fontSize: 32, fontWeight: v.displayWeight, color: v.text, letterSpacing: v.displayTracking, textTransform: v.displayTransform }}>{m.ta.name}</div>
            <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid }}>captain · {m.ta.captain?.tag}</div>
          </div>
          <TeamBadge team={m.ta} size={72} />
        </div>

        <div style={{ display: "grid", placeItems: "center", gap: 8, padding: "0 20px" }}>
          {live && <div style={{
            padding: "3px 10px", background: v.danger, color: "#0a0c10",
            fontFamily: v.monoFont, fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", borderRadius: v.rsm,
          }}>● LIVE · MAP 2</div>}
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, fontFamily: v.monoFont, fontWeight: 700, fontSize: 64, color: v.text, letterSpacing: "-0.04em", lineHeight: 1 }}>
            <span style={{ color: m.ta.color }}>{m.score.a}</span>
            <span style={{ color: v.textDim, fontSize: 28 }}>:</span>
            <span style={{ color: m.tb.color }}>{m.score.b}</span>
          </div>
          <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid, letterSpacing: "0.12em" }}>BO3 · ROUND {m.round} · REGULAR</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <TeamBadge team={m.tb} size={72} />
          <div>
            <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim, letterSpacing: "0.12em" }}>SEED #{m.tb.seed}</div>
            <div style={{ fontFamily: v.displayFont, fontSize: 32, fontWeight: v.displayWeight, color: v.text, letterSpacing: v.displayTracking, textTransform: v.displayTransform }}>{m.tb.name}</div>
            <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid }}>captain · {m.tb.captain?.tag}</div>
          </div>
        </div>
      </div>

      <div style={{ padding: "24px 36px", display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18 }}>
        <div style={{ display: "grid", gap: 18 }}>
          <Panel label="MAPS">
            <div style={{ display:"grid", gap: 8 }}>
              {m.maps.map((map, i) => {
                const done = map.done;
                const winnerA = done && map.aScore > map.bScore;
                return (
                  <div key={i} style={{
                    display: "grid", gridTemplateColumns: "32px 1fr auto 60px auto 1fr", gap: 14, alignItems: "center",
                    padding: "10px 12px",
                    background: i === 1 ? v.accent + "08" : v.panelLow,
                    border: `1px solid ${i === 1 ? v.accent + "44" : v.border}`,
                    borderRadius: v.rsm,
                  }}>
                    <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim, letterSpacing:"0.1em" }}>{["M1","M2","M3"][i]}</div>
                    <div style={{ fontFamily: v.displayFont, fontWeight: v.displayWeight, fontSize: 16, color: v.text }}>{map.name}</div>
                    <div style={{ fontFamily: v.monoFont, fontWeight: 700, fontSize: 20, color: winnerA ? m.ta.color : v.textMid }}>{done || i === 1 ? map.aScore : "—"}</div>
                    <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim, textAlign:"center" }}>{i === 1 && !done ? "LIVE" : ""}</div>
                    <div style={{ fontFamily: v.monoFont, fontWeight: 700, fontSize: 20, color: !winnerA && done ? m.tb.color : v.textMid }}>{done || i === 1 ? map.bScore : "—"}</div>
                    <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid, letterSpacing: "0.06em" }}>{done ? (winnerA ? m.ta.tag : m.tb.tag) + " WIN" : i === 1 ? "IN PROGRESS" : "PENDING"}</div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel label={`${m.ta.tag} · STATS · INFERNO`}>
            <PlayerStatsTable players={m.ta.roster.slice(0, 5)} color={m.ta.color} />
          </Panel>
          <Panel label={`${m.tb.tag} · STATS · INFERNO`}>
            <PlayerStatsTable players={m.tb.roster.slice(0, 5)} color={m.tb.color} />
          </Panel>
        </div>

        <div style={{ display:"grid", gap: 16 }}>
          <Panel label="MVP VOTE">
            <div style={{ fontFamily: v.bodyFont, fontSize: 13, color: v.textMid, marginBottom: 12 }}>
              本场最佳投票 · 比赛结束后开放
            </div>
            {m.ta.roster.slice(0, 3).map((p) => (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns:"auto 1fr auto", gap: 10, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${v.border}` }}>
                <Avatar name={p.tag} size={28} />
                <div>
                  <div style={{ fontFamily: v.bodyFont, fontWeight: 600, color: v.text, fontSize: 13 }}>{p.tag}</div>
                  <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim }}>R {p.hltv.toFixed(2)}</div>
                </div>
                <Btn small disabled>+ 投票</Btn>
              </div>
            ))}
          </Panel>

          <Panel label="HEAD TO HEAD">
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "center" }}>
              <div style={{ textAlign: "right", fontFamily: v.monoFont, fontSize: 28, fontWeight: 700, color: m.ta.color }}>2</div>
              <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textDim }}>ALL TIME</div>
              <div style={{ fontFamily: v.monoFont, fontSize: 28, fontWeight: 700, color: m.tb.color }}>1</div>
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 14 }}>
              {["W","W","L","W"].map((r, i) => (
                <div key={i} style={{ width: 26, height: 26, display: "grid", placeItems: "center", background: r === "W" ? m.ta.color + "22" : m.tb.color + "22", color: r === "W" ? m.ta.color : m.tb.color, fontFamily: v.monoFont, fontWeight: 700, fontSize: 12, borderRadius: v.rsm }}>{r}</div>
              ))}
            </div>
          </Panel>

          <Panel label="VENUE">
            <div style={{ display:"grid", gap: 6, fontFamily: v.monoFont, fontSize: 12 }}>
              <KV k="DATE" val={m.scheduledAt} />
              <KV k="TIME" val={m.time + " CST"} />
              <KV k="MODE" val="PERFECT WORLD" />
              <KV k="OBSERVER" val="ph4se" />
              <KV k="STREAM" val={<span style={{ color: v.accent }}>bilibili/RivalHub</span>} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
function KV({ k, val }) {
  const v = useVariant();
  return (
    <div style={{ display:"grid", gridTemplateColumns:"100px 1fr", gap: 8 }}>
      <span style={{ color: v.textDim, letterSpacing: "0.1em" }}>{k}</span>
      <span style={{ color: v.text }}>{val}</span>
    </div>
  );
}
function PlayerStatsTable({ players, color }) {
  const v = useVariant();
  return (
    <table style={{ width:"100%", borderCollapse: "collapse", fontFamily: v.monoFont, fontSize: 12 }}>
      <thead>
        <tr style={{ color: v.textDim }}>
          <th style={{ textAlign:"left", padding:"4px 0", letterSpacing:"0.1em", fontWeight: 600 }}>PLAYER</th>
          <th style={{ textAlign:"right", padding:"4px 0", fontWeight: 600 }}>K</th>
          <th style={{ textAlign:"right", padding:"4px 0", fontWeight: 600 }}>D</th>
          <th style={{ textAlign:"right", padding:"4px 0", fontWeight: 600 }}>A</th>
          <th style={{ textAlign:"right", padding:"4px 0", fontWeight: 600 }}>ADR</th>
          <th style={{ textAlign:"right", padding:"4px 0", fontWeight: 600 }}>RAT</th>
        </tr>
      </thead>
      <tbody>
        {players.map((p, i) => (
          <tr key={p.id} style={{ borderTop: `1px solid ${v.border}` }}>
            <td style={{ padding: "8px 0", display:"flex", alignItems:"center", gap: 8 }}>
              <span style={{ width: 4, height: 16, background: color }} />
              <Avatar name={p.tag} size={22} />
              <span style={{ color: v.text, fontFamily: v.bodyFont, fontWeight: 600, fontSize: 13 }}>{p.tag}</span>
              {p.isCaptain && <span style={{ color: v.accent, fontSize: 10 }}>★</span>}
            </td>
            <td style={{ padding: "8px 0", textAlign:"right", color: v.text, fontWeight: 700 }}>{18 + i}</td>
            <td style={{ padding: "8px 0", textAlign:"right", color: v.text }}>{14 + (i % 3)}</td>
            <td style={{ padding: "8px 0", textAlign:"right", color: v.text }}>{4 + (i % 4)}</td>
            <td style={{ padding: "8px 0", textAlign:"right", color: v.text }}>{Math.round(p.adr)}</td>
            <td style={{ padding: "8px 0", textAlign:"right", color: v.accent, fontWeight: 700 }}>{p.hltv.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

window.MatchesScreen = MatchesScreen;
window.MatchDetailScreen = MatchDetailScreen;
