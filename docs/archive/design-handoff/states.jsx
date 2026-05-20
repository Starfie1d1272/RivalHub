/* global React, useVariant, Panel, Btn, Marker */

/* =========================================================================
   STATE PRIMITIVES — loading / empty / error / status banner / spinner
   ========================================================================= */

function Skeleton({ w = "100%", h = 16, mt = 0, radius }) {
  const v = useVariant();
  return (
    <div style={{
      width: w, height: h, marginTop: mt,
      background: `linear-gradient(90deg, ${v.panelLow} 0%, ${v.border} 40%, ${v.panelLow} 80%)`,
      backgroundSize: "200% 100%",
      animation: "skel 1.4s ease-in-out infinite",
      borderRadius: radius != null ? radius : v.rsm,
    }} />
  );
}

function SkeletonRow({ cols = [1, 2, 1, 1] }) {
  const v = useVariant();
  return (
    <div style={{
      display: "grid", gridTemplateColumns: cols.map((c) => `${c}fr`).join(" "),
      gap: 14, padding: "12px 16px", borderBottom: `1px solid ${v.border}`,
    }}>
      {cols.map((_, i) => <Skeleton key={i} h={14} />)}
    </div>
  );
}

function Spinner({ size = 18, label }) {
  const v = useVariant();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{
        width: size, height: size,
        border: `2px solid ${v.border}`,
        borderTopColor: v.accent,
        borderRadius: 999, display: "inline-block",
        animation: "spin 0.8s linear infinite",
      }} />
      {label && <span style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid, letterSpacing: "0.1em" }}>{label}</span>}
    </span>
  );
}

function EmptyState({ icon = "◇", title, sub, action, accent }) {
  const v = useVariant();
  return (
    <div style={{ padding: "48px 24px", textAlign: "center" }}>
      <div style={{
        width: 56, height: 56, margin: "0 auto 14px",
        border: `1px solid ${accent ? v.accent + "55" : v.border}`,
        background: accent ? v.accent + "10" : v.panelLow,
        color: accent ? v.accent : v.textDim,
        display: "grid", placeItems: "center",
        fontSize: 22, borderRadius: v.rmd,
      }}>{icon}</div>
      <div style={{
        fontFamily: v.displayFont, fontWeight: v.displayWeight, fontSize: 18,
        color: v.text, letterSpacing: v.displayTracking,
      }}>{title}</div>
      {sub && (
        <div style={{
          fontFamily: v.monoFont, fontSize: 11, color: v.textMid,
          marginTop: 8, maxWidth: 380, marginLeft: "auto", marginRight: "auto",
          lineHeight: 1.6, letterSpacing: "0.04em",
        }}>{sub}</div>
      )}
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  );
}

function ErrorState({ title = "出错了", sub, code = "ERR_500", onRetry }) {
  const v = useVariant();
  return (
    <div style={{ padding: "40px 24px", textAlign: "center" }}>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: "4px 10px", marginBottom: 14,
        border: `1px solid ${v.danger}55`, background: v.danger + "10",
        color: v.danger, fontFamily: v.monoFont, fontSize: 11,
        letterSpacing: "0.14em", borderRadius: v.rsm,
      }}>● {code}</div>
      <div style={{
        fontFamily: v.displayFont, fontWeight: v.displayWeight, fontSize: 22,
        color: v.text, letterSpacing: v.displayTracking,
      }}>{title}</div>
      {sub && (
        <div style={{
          fontFamily: v.monoFont, fontSize: 11, color: v.textMid,
          marginTop: 8, lineHeight: 1.6, letterSpacing: "0.04em",
          maxWidth: 460, marginLeft: "auto", marginRight: "auto",
        }}>{sub}</div>
      )}
      {onRetry && (
        <div style={{ marginTop: 18, display: "flex", justifyContent: "center", gap: 8 }}>
          <Btn primary onClick={onRetry}>↻ 重试</Btn>
          <Btn ghost>查看日志</Btn>
        </div>
      )}
    </div>
  );
}

/* Status banner: full-width row that lives ABOVE content to communicate
   non-blocking states like "voting closed", "demo uploaded", etc. */
function StatusBanner({ tone = "info", title, sub, action, dismiss }) {
  const v = useVariant();
  const tones = {
    info:    { c: v.accent, glyph: "●" },
    success: { c: v.ok,     glyph: "✓" },
    warn:    { c: v.warn,   glyph: "▲" },
    error:   { c: v.danger, glyph: "✕" },
    live:    { c: v.danger, glyph: "●" },
  }[tone];
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 14, alignItems: "center",
      padding: "10px 16px",
      background: tones.c + "10",
      border: `1px solid ${tones.c}55`,
      borderLeft: `3px solid ${tones.c}`,
      borderRadius: v.rsm,
    }}>
      <div style={{
        width: 22, height: 22, color: tones.c,
        border: `1px solid ${tones.c}55`, background: tones.c + "1f",
        borderRadius: v.rsm, display: "grid", placeItems: "center",
        fontFamily: v.monoFont, fontSize: 11, fontWeight: 700,
      }}>{tones.glyph}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: v.bodyFont, fontWeight: 600, fontSize: 13, color: v.text }}>{title}</div>
        {sub && <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid, marginTop: 2 }}>{sub}</div>}
      </div>
      {action || <span />}
      {dismiss && (
        <button onClick={dismiss} style={{
          background: "transparent", border: "none", color: v.textDim, cursor: "pointer",
          fontFamily: v.monoFont, fontSize: 14, padding: "0 4px",
        }}>×</button>
      )}
    </div>
  );
}

/* Inline confirm prompt: appears inline rather than as a modal */
function InlineConfirm({ title, sub, danger, onConfirm, onCancel }) {
  const v = useVariant();
  const c = danger ? v.danger : v.warn;
  return (
    <div style={{
      padding: "12px 16px",
      background: c + "0d",
      border: `1px solid ${c}55`,
      borderLeft: `3px solid ${c}`,
      borderRadius: v.rsm,
      display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center",
    }}>
      <div>
        <div style={{ fontFamily: v.bodyFont, fontWeight: 600, fontSize: 13, color: v.text }}>{title}</div>
        {sub && <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid, marginTop: 3 }}>{sub}</div>}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <Btn ghost small onClick={onCancel}>取消</Btn>
        <Btn small danger={danger} primary={!danger} onClick={onConfirm}>{danger ? "确认删除" : "确认"}</Btn>
      </div>
    </div>
  );
}

/* =========================================================================
   STATES GALLERY — full screen showing every state in context
   ========================================================================= */

function StatesScreen({ go }) {
  const v = useVariant();

  const [showBanner1, setShowBanner1] = React.useState(true);
  const [showBanner2, setShowBanner2] = React.useState(true);
  const [showConfirm, setShowConfirm] = React.useState(true);

  return (
    <div style={{ padding: "28px 36px 60px", maxWidth: 1320, margin: "0 auto" }}>
      <Marker num={0} sub="LOADING · EMPTY · ERROR · BOUNDARIES">STATES · 状态边界</Marker>
      <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid, lineHeight: 1.7, marginBottom: 28, letterSpacing: "0.04em" }}>
        每个屏幕都有它"非happy path"的样子。这一页把所有状态边界放在一起,方便审阅 · 真实页面里这些状态会替换对应的内容区,而非新开页面。
      </div>

      {/* SECTION 1: BANNERS */}
      <SectionHeader n="01" title="STATUS BANNERS · 通知条" sub="非阻塞性 · 出现在内容区上方" />
      <div style={{ display: "grid", gap: 10, marginBottom: 32 }}>
        {showBanner1 && <StatusBanner tone="info" title="选秀将于 04-13 周六 20:00 开始" sub="队长请提前到场 · 错过开始即失去本轮选人权" action={<Btn small>加入日历</Btn>} dismiss={() => setShowBanner1(false)} />}
        {showBanner2 && <StatusBanner tone="warn" title="比赛 demo 尚未上传" sub="VOID vs ASCEND · 截止 04-14 23:59 · 逾期此场判负 0-2" action={<Btn small primary>上传 demo</Btn>} dismiss={() => setShowBanner2(false)} />}
        <StatusBanner tone="error" title="选秀因技术原因暂停 · 03:42" sub="管理员正在恢复 · 时钟已冻结 · 已发送邮件通知所有队长" action={<Btn small ghost>查看公告</Btn>} />
        <StatusBanner tone="success" title="报名已通过审核" sub="位置 IGL · 战队选择阶段开启于 04-10 12:00" />
        <StatusBanner tone="live" title="● LIVE · ROUND 3 · MERIDIAN ON CLOCK" sub="01:27 剩余 · 当前 BAN: ph4se · valor · jett · k1ngd0m" action={<Btn small primary onClick={() => go("draft")}>进入直播间 →</Btn>} />
      </div>

      {/* SECTION 2: INLINE CONFIRM */}
      <SectionHeader n="02" title="INLINE CONFIRM · 内联确认" sub="替代 modal · 不打断当前上下文" />
      <div style={{ display: "grid", gap: 10, marginBottom: 32 }}>
        {showConfirm && (
          <InlineConfirm
            danger
            title="确认从战队 VOID 移除 k1ngd0m?"
            sub="本操作无法撤销 · 该选手将进入 free agent 池"
            onConfirm={() => setShowConfirm(false)}
            onCancel={() => setShowConfirm(false)}
          />
        )}
        <InlineConfirm
          title="发布赛季 S04 SPRING 2026?"
          sub="发布后所有用户可见 · 报名链接生效 · 仍可在赛季管理中暂停"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      </div>

      {/* SECTION 3: LOADING */}
      <SectionHeader n="03" title="LOADING · 骨架屏与加载条" sub="结构先行 · 内容后填" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 32 }}>
        <Panel label="MATCHES · LOADING">
          <SkeletonLoaderMatches />
        </Panel>
        <Panel label="STATS LEADERBOARD · LOADING">
          <SkeletonLoaderStats />
        </Panel>
        <Panel label="DRAFT ROOM · CONNECTING" hi>
          <div style={{ display: "grid", placeItems: "center", padding: 32, gap: 12 }}>
            <Spinner size={28} />
            <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid, letterSpacing: "0.12em" }}>CONNECTING TO DRAFT ROOM…</div>
            <div style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim }}>ws://draft.rivalhub.local/s4 · attempt 1/3</div>
          </div>
        </Panel>
        <Panel label="ACTION · INLINE LOADING">
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: v.panelLow, border: `1px solid ${v.border}`, borderRadius: v.rsm }}>
              <span style={{ fontFamily: v.monoFont, fontSize: 12 }}>提交报名表…</span>
              <Spinner label="SUBMITTING" />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: v.panelLow, border: `1px solid ${v.border}`, borderRadius: v.rsm }}>
              <span style={{ fontFamily: v.monoFont, fontSize: 12 }}>上传 demo 文件 · valoraries.dem</span>
              <span style={{ fontFamily: v.monoFont, fontSize: 12, color: v.accent }}>62%</span>
            </div>
            <div style={{ height: 4, background: v.border, borderRadius: 999, overflow: "hidden" }}>
              <div style={{ height: "100%", width: "62%", background: v.accent }} />
            </div>
          </div>
        </Panel>
      </div>

      {/* SECTION 4: EMPTY STATES */}
      <SectionHeader n="04" title="EMPTY · 空状态" sub="第一次进入 · 还没有数据 · 引导用户做点什么" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 32 }}>
        <Panel pad={0}>
          <EmptyState
            accent icon="◢"
            title="还没有报名记录"
            sub="赛季 S04 报名将于 04-10 12:00 开启 · 关注通知不要错过"
            action={<Btn primary onClick={() => go("register")}>查看赛季 →</Btn>}
          />
        </Panel>
        <Panel pad={0}>
          <EmptyState
            icon="✦"
            title="队长投票尚未开启"
            sub="报名截止后管理员将提名 6 位候选 · 由全体选手投票产生 4 位队长"
          />
        </Panel>
        <Panel pad={0}>
          <EmptyState
            icon="◇"
            title="本赛季还没有比赛记录"
            sub="选秀完成后 schedule 会自动生成 · BO1 小组循环 + BO3 季后赛"
            action={<Btn ghost>查看赛制规则</Btn>}
          />
        </Panel>
        <Panel pad={0}>
          <EmptyState
            icon="✕"
            title="未找到匹配的选手"
            sub="试试用 Steam ID 搜索 · 或检查拼写"
            action={<Btn small ghost>清除筛选</Btn>}
          />
        </Panel>
        <Panel pad={0}>
          <EmptyState
            icon="◐"
            title="数据样本不足"
            sub="少于 5 张地图的选手不计入排行 · 等本周比赛打完即可上榜"
          />
        </Panel>
        <Panel pad={0}>
          <EmptyState
            icon="◯"
            title="还没有任何关注"
            sub="点选手 / 战队主页的「关注」按钮 · 他们打比赛时会推送给你"
            action={<Btn small onClick={() => go("teams")}>浏览战队</Btn>}
          />
        </Panel>
      </div>

      {/* SECTION 5: ERROR STATES */}
      <SectionHeader n="05" title="ERROR · 错误页" sub="网络 · 权限 · 404 · 服务异常" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 32 }}>
        <Panel pad={0}>
          <ErrorState
            code="ERR_NETWORK"
            title="无法连接到 RivalHub"
            sub="请检查网络后重试 · 如果问题持续 · 你可以查看运行日志或在 GitHub 提交 issue"
            onRetry={() => {}}
          />
        </Panel>
        <Panel pad={0}>
          <ErrorState
            code="ERR_403"
            title="你没有权限访问后台"
            sub="只有赛季管理员或根管理员可访问 /admin · 如需权限 · 联系 RivalHub_root 申请邀请码"
            onRetry={() => go("invite")}
          />
        </Panel>
        <Panel pad={0}>
          <ErrorState
            code="ERR_404"
            title="比赛不存在或已被删除"
            sub="它可能因双方都未提交结果被管理员判废 · 你可以返回赛程查看其他比赛"
            onRetry={() => go("matches")}
          />
        </Panel>
        <Panel pad={0}>
          <ErrorState
            code="ERR_CONFLICT"
            title="你已经在另一个战队"
            sub="一名选手在同一赛季只能加入一支战队 · 如需更换 · 请联系赛季管理员"
          />
        </Panel>
      </div>

      {/* SECTION 6: BOUNDARY GALLERY (in-context) */}
      <SectionHeader n="06" title="IN-CONTEXT BOUNDARIES · 真实嵌入" sub="状态嵌入到目标页面的样子" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* registration closed card */}
        <Panel label="REGISTRATION · CLOSED">
          <div style={{ padding: "8px 0" }}>
            <div style={{ fontFamily: v.displayFont, fontWeight: v.displayWeight, fontSize: 20, color: v.text }}>报名已截止</div>
            <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid, marginTop: 6 }}>2026-04-10 12:00:00 ~ 2026-04-13 23:59:59</div>
            <div style={{ marginTop: 14, padding: 12, background: v.panelLow, border: `1px solid ${v.border}`, borderRadius: v.rsm, display: "grid", gap: 8 }}>
              <RegStat label="REGISTERED" value="32 / 32" full />
              <RegStat label="WAITLIST" value="6" />
              <RegStat label="DROPPED" value="0" />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <Btn ghost full disabled>报名已截止</Btn>
              <Btn primary full onClick={() => go("captains")}>查看下一步 →</Btn>
            </div>
          </div>
        </Panel>

        {/* match cancelled */}
        <Panel label="MATCH · DEFAULTED">
          <div style={{ padding: "8px 0" }}>
            <StatusBanner tone="error" title="本场判负 · 双方均未在截止时间前上传 demo" sub="管理员裁定 · MERIDIAN 0-0 PARALLAX · 双方均不计算 rating" />
            <div style={{ marginTop: 14, fontFamily: v.monoFont, fontSize: 11, color: v.textMid, lineHeight: 1.7 }}>
              · 04-14 23:59 截止<br />
              · 双方均未提交结果 · 进入仲裁<br />
              · 04-15 02:14 管理员判废 · 双方扣 1 积分
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <Btn ghost>查看仲裁记录</Btn>
              <Btn ghost>申诉</Btn>
            </div>
          </div>
        </Panel>

        {/* permissions */}
        <Panel label="ADMIN · NO PERMISSION">
          <ErrorState
            code="ERR_403"
            title="你不是本赛季的管理员"
            sub="只能查看公开信息 · 需要管理权限请向 RivalHub_root 申请"
          />
        </Panel>

        {/* offline */}
        <Panel label="LIVE DRAFT · CONNECTION LOST">
          <div style={{ padding: "20px 8px", textAlign: "center" }}>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "4px 10px", background: v.warn + "10", color: v.warn,
              border: `1px solid ${v.warn}55`, borderRadius: v.rsm,
              fontFamily: v.monoFont, fontSize: 11, letterSpacing: "0.12em",
            }}>▲ DISCONNECTED · RETRYING…</div>
            <div style={{ fontFamily: v.displayFont, fontSize: 18, fontWeight: v.displayWeight, marginTop: 12, color: v.text }}>实时连接已断开</div>
            <div style={{ fontFamily: v.monoFont, fontSize: 11, color: v.textMid, marginTop: 6 }}>
              选秀进度仍在服务端 · 重连后会自动同步 · 当前时钟已暂停
            </div>
            <div style={{ marginTop: 14, display: "inline-block" }}>
              <Spinner label="ATTEMPTING 2/3 · 0:08" />
            </div>
          </div>
        </Panel>
      </div>

      <style>{`
        @keyframes skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function SectionHeader({ n, title, sub }) {
  const v = useVariant();
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, margin: "8px 0 14px" }}>
      <span style={{ fontFamily: v.monoFont, fontSize: 11, color: v.accent, letterSpacing: "0.14em", fontWeight: 700 }}>[ {n} ]</span>
      <span style={{ fontFamily: v.displayFont, fontWeight: v.displayWeight, fontSize: 17, color: v.text, letterSpacing: v.displayTracking }}>{title}</span>
      <span style={{ fontFamily: v.monoFont, fontSize: 10, color: v.textDim, letterSpacing: "0.08em" }}>{sub}</span>
      <div style={{ flex: 1, height: 1, background: v.border, marginLeft: 4 }} />
    </div>
  );
}

function RegStat({ label, value, full }) {
  const v = useVariant();
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: v.monoFont, fontSize: 12 }}>
      <span style={{ color: v.textDim, letterSpacing: "0.1em" }}>{label}</span>
      <span style={{ color: full ? v.danger : v.text, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function SkeletonLoaderMatches() {
  return (
    <div style={{ margin: -16, marginBottom: -16 }}>
      {[0, 1, 2, 3].map((i) => <SkeletonRow key={i} cols={[1, 1.4, 0.8, 0.8, 1]} />)}
    </div>
  );
}

function SkeletonLoaderStats() {
  return (
    <div style={{ margin: -16, marginBottom: -16 }}>
      {[0, 1, 2, 3, 4].map((i) => <SkeletonRow key={i} cols={[0.4, 1.4, 0.6, 0.6, 0.6, 0.6]} />)}
    </div>
  );
}

Object.assign(window, { Skeleton, SkeletonRow, Spinner, EmptyState, ErrorState, StatusBanner, InlineConfirm, StatesScreen });
