import Link from "next/link";
import { and, eq, not, count, or, desc, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons, teams, seasonRegistrations, users } from "@/db/schema";
import { captainVotes } from "@/db/schema/votes";
import { matches } from "@/db/schema/matches";
import { APP_BRAND } from "@/lib/branding";
import { SEASON_STATUS_LABELS } from "@/types/season";
import { normalizeRegistrationConfig } from "@/types/season";
import { Panel, Btn, Marker, StatusPill, EmptyState, MiniStat } from "@/components/rivalhub";

export default async function HomePage() {
  const activeSeasons = await db
    .select()
    .from(seasons)
    .where(
      and(
        not(eq(seasons.status, "archived")),
        not(eq(seasons.status, "draft"))
      )
    )
    .orderBy(seasons.createdAt);

  const featured = activeSeasons[0];
  const others = activeSeasons.slice(1);

  if (!featured) {
    return (
      <div className="mx-auto px-4 lg:px-9 py-8 max-w-[1240px]">
        <Panel>
          <EmptyState
            title="暂无进行中的赛季"
            sub="请通过管理后台创建赛季。"
          />
        </Panel>
      </div>
    );
  }

  // 历届已归档赛季
  const archivedSeasons = await db
    .select({ id: seasons.id, name: seasons.name, slug: seasons.slug, kind: seasons.kind, status: seasons.status })
    .from(seasons)
    .where(eq(seasons.status, "archived"))
    .orderBy(desc(seasons.createdAt))
    .limit(6);

  // 并行查询：基础统计 + 按状态的动态数据
  const [
    [featuredTeamCount],
    [featuredPlayerCount],
    registrationCounts,
    topVoteCandidates,
    liveAndUpcomingMatches,
  ] = await Promise.all([
    db.select({ value: count() }).from(teams).where(eq(teams.seasonId, featured.id)),
    db.select({ value: count() }).from(seasonRegistrations).where(
      and(eq(seasonRegistrations.seasonId, featured.id), eq(seasonRegistrations.status, "approved"))
    ),
    // 仅 registration 状态时查询
    featured.status === "registration"
      ? db
          .select({
            position: seasonRegistrations.primaryPosition,
            cnt: count(),
          })
          .from(seasonRegistrations)
          .where(
            and(
              eq(seasonRegistrations.seasonId, featured.id),
              or(
                eq(seasonRegistrations.status, "approved"),
                eq(seasonRegistrations.status, "pending")
              )
            )
          )
          .groupBy(seasonRegistrations.primaryPosition)
      : Promise.resolve([] as { position: string; cnt: number }[]),
    // 仅 voting 状态时查询 TOP 3 候选人
    featured.status === "voting"
      ? db
          .select({
            candidateRegistrationId: captainVotes.candidateRegistrationId,
            voteCount: count(),
          })
          .from(captainVotes)
          .where(
            inArray(
              captainVotes.candidateRegistrationId,
              db
                .select({ id: seasonRegistrations.id })
                .from(seasonRegistrations)
                .where(eq(seasonRegistrations.seasonId, featured.id))
            )
          )
          .groupBy(captainVotes.candidateRegistrationId)
          .orderBy(desc(count()))
          .limit(3)
      : Promise.resolve([] as { candidateRegistrationId: string; voteCount: number }[]),
    // 仅 playing 状态时查询 LIVE + 下一场
    featured.status === "playing"
      ? db
          .select({
            id: matches.id,
            status: matches.status,
            scheduledAt: matches.scheduledAt,
            format: matches.format,
          })
          .from(matches)
          .where(
            and(
              eq(matches.seasonId, featured.id),
              or(
                eq(matches.status, "in_progress"),
                eq(matches.status, "scheduled")
              )
            )
          )
          .orderBy(matches.scheduledAt)
          .limit(2)
      : Promise.resolve([] as { id: string; status: string; scheduledAt: Date | null; format: string }[]),
  ]);

  // voting 状态：查询候选人名字
  let topCandidatesWithNames: { name: string; voteCount: number }[] = [];
  if (featured.status === "voting" && topVoteCandidates.length > 0) {
    const regIds = topVoteCandidates.map((v) => v.candidateRegistrationId);
    const regRows = await db
      .select({
        id: seasonRegistrations.id,
        userId: seasonRegistrations.userId,
      })
      .from(seasonRegistrations)
      .where(inArray(seasonRegistrations.id, regIds));

    const userIds = regRows.map((r) => r.userId);
    const userRows = await db
      .select({ id: users.id, perfectName: users.perfectName, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, userIds));

    topCandidatesWithNames = topVoteCandidates.map((v) => {
      const reg = regRows.find((r) => r.id === v.candidateRegistrationId);
      const user = reg ? userRows.find((u) => u.id === reg.userId) : undefined;
      const name = user?.displayName ?? user?.perfectName ?? "未知选手";
      return { name, voteCount: Number(v.voteCount) };
    });
  }

  // registration 状态：整理位置报名数据
  const regConfig = normalizeRegistrationConfig(featured.registrationConfig);
  const maxPerPosition = regConfig.maxPerPosition;
  const positionCountMap = new Map<string, number>(
    registrationCounts.map((r) => [r.position, Number(r.cnt)])
  );

  // 构建动态 eyebrow 和右侧面板类型
  const eyebrow = (() => {
    if (featured.status === "registration") {
      return { text: "● REGISTRATION OPEN", color: "var(--color-ok)" };
    }
    if (featured.status === "voting") {
      return { text: "● CAPTAIN VOTING", color: "var(--color-warn)" };
    }
    if (featured.status === "playing") {
      return { text: "● SEASON IN PROGRESS", color: "var(--color-ok)" };
    }
    return {
      text: `[ RIVALHUB / ${featured.slug.replace(/-/g, " ").toUpperCase()} ]`,
      color: "var(--color-accent)",
    };
  })();

  // 分层导航数据
  const allNavEntries = [
    { key: "register", href: `/${featured.slug}/register`, label: "报名参赛", mono: "REGISTER", meta: "个人报名", show: featured.registrationMode === "solo" },
    { key: "captains", href: `/${featured.slug}/captains`, label: "队长投票", mono: "CAPTAINS", meta: "实时票数", show: featured.hasCaptainVoting },
    { key: "draft", href: `/${featured.slug}/draft`, label: "选秀直播间", mono: "DRAFT ROOM", meta: "● LIVE", show: featured.hasDraft },
    { key: "teams", href: `/${featured.slug}/teams`, label: "战队阵容", mono: "TEAMS", meta: "战队展示", show: true },
    { key: "matches", href: `/${featured.slug}/matches`, label: "赛程对决", mono: "MATCHES", meta: "Bracket · 赛果", show: true },
    { key: "stats", href: `/${featured.slug}/stats`, label: "数据排行", mono: "STATS", meta: "Rating · ADR", show: true },
    { key: "seasons", href: "/seasons", label: "历史赛季", mono: "ARCHIVE", meta: "浏览回顾", show: true },
    { key: "login", href: "/login", label: "登录后台", mono: "LOGIN", meta: "管理员 · 队长", show: true },
  ].filter((e) => e.show);

  // Tier 1：根据状态决定主入口
  const tier1Key = (() => {
    if (featured.status === "registration") return "register";
    if (featured.status === "voting") return "captains";
    if (featured.status === "playing") return "matches";
    return null;
  })();

  const tier1Entry = tier1Key
    ? allNavEntries.find((e) => e.key === tier1Key) ?? null
    : null;

  // Tier 2：从剩余中取4个（排除 tier1、login、seasons）
  const tier2Candidates = allNavEntries.filter(
    (e) => e.key !== tier1Key && e.key !== "login" && e.key !== "seasons"
  );
  const tier2Entries = tier2Candidates.slice(0, 4);

  // Tier 3：次要入口（login + seasons 以及 tier2 溢出部分）
  const tier3Entries = [
    ...tier2Candidates.slice(4),
    ...allNavEntries.filter((e) => e.key === "seasons" || e.key === "login"),
  ];

  return (
    <div className="mx-auto px-4 lg:px-9 py-8 max-w-[1240px] grid gap-7">
      {/* Hero */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-[1.6fr_1fr]">
        <Panel className="overflow-hidden relative" pad={0}>
          <div className="p-7 relative z-10">
            <div
              className="mb-3 font-bold"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: eyebrow.color,
                letterSpacing: "var(--tracking-eyebrow)",
              }}
            >
              {eyebrow.text}
            </div>
            <h1
              className="font-semibold leading-[0.95] m-0 text-4xl lg:text-[56px]"
              style={{
                fontFamily: "var(--font-display)",
                letterSpacing: "var(--tracking-tight-2)",
                color: "var(--color-fg)",
              }}
            >
              {APP_BRAND.name}
              <br />
              <span style={{ color: "var(--color-accent)" }}>{featured.name}</span>
            </h1>
            <div
              className="mt-3.5 max-w-[520px] leading-relaxed"
              style={{ color: "var(--color-fg-mid)", fontSize: 14 }}
            >
              {APP_BRAND.description}
            </div>
            <div className="flex gap-2.5 mt-5.5 flex-wrap">
              <Btn primary asChild>
                <Link href={`/${featured.slug}`}>进入赛季 →</Link>
              </Btn>
              {featured.registrationMode === "solo" && (
                <Btn asChild>
                  <Link href={`/${featured.slug}/register`}>报名参赛</Link>
                </Btn>
              )}
              <Btn ghost asChild>
                <Link href="/seasons">查看所有赛季</Link>
              </Btn>
            </div>
          </div>
          <div
            aria-hidden
            className="absolute inset-0 opacity-50 pointer-events-none"
            style={{
              background: `
                radial-gradient(circle at 90% 10%, ${
                  featured.status === "registration" ? "rgba(77,212,122,0.09)"
                    : featured.status === "voting" ? "rgba(255,196,77,0.09)"
                    : "rgba(255,107,26,0.13)"
                } 0, transparent 40%),
                repeating-linear-gradient(0deg, transparent 0 32px, rgba(31,37,48,0.25) 32px 33px)
              `,
            }}
          />
        </Panel>

        {/* 右侧动态面板 */}
        {featured.status === "registration" ? (
          <Panel label="REGISTRATION">
            <div className="grid gap-3.5">
              <div>
                <div
                  className="uppercase"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--color-fg-dim)",
                    letterSpacing: "var(--tracking-label)",
                  }}
                >
                  {SEASON_STATUS_LABELS[featured.status]}
                </div>
                <div
                  className="mt-1 font-semibold"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 20,
                    color: "var(--color-fg)",
                  }}
                >
                  {featured.name}
                </div>
              </div>
              <div className="grid gap-2">
                {featured.positions.map((pos) => {
                  const filled = positionCountMap.get(pos) ?? 0;
                  const pct = maxPerPosition > 0 ? Math.min(100, Math.round((filled / maxPerPosition) * 100)) : 0;
                  return (
                    <div key={pos}>
                      <div className="flex justify-between mb-1" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--color-fg-dim)", letterSpacing: "var(--tracking-label)" }}>
                        <span className="uppercase">{pos}</span>
                        <span style={{ color: "var(--color-fg-mid)" }}>{filled} / {maxPerPosition}</span>
                      </div>
                      <div className="h-[3px] rounded-full" style={{ background: "var(--color-border)" }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            background: pct >= 90 ? "var(--color-warn)" : "var(--color-accent)",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <Btn full asChild>
                <Link href={`/${featured.slug}/register`} className="w-full">
                  立即报名 →
                </Link>
              </Btn>
            </div>
          </Panel>
        ) : featured.status === "voting" ? (
          <Panel label="投票排行 · TOP 3">
            <div className="grid gap-3">
              {topCandidatesWithNames.length > 0 ? (
                topCandidatesWithNames.map((c, i) => (
                  <div
                    key={i}
                    className="grid items-center gap-3"
                    style={{
                      gridTemplateColumns: "auto 1fr auto",
                      padding: "10px 12px",
                      background: i === 0 ? "rgba(255,107,26,0.04)" : "var(--color-panel-low)",
                      border: `1px solid ${i === 0 ? "rgba(255,107,26,0.27)" : "var(--color-border)"}`,
                      borderRadius: "var(--radius-sm, 2px)",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 20,
                        fontWeight: 700,
                        color: i === 0 ? "var(--color-accent)" : "var(--color-fg-mid)",
                      }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "var(--color-fg)" }}>
                        {c.name}
                      </div>
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 18,
                        fontWeight: 700,
                        color: "var(--color-fg)",
                      }}
                    >
                      {c.voteCount}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-fg-dim)" }}>
                  暂无投票数据
                </div>
              )}
            </div>
            <Btn full asChild style={{ marginTop: 14 }}>
              <Link href={`/${featured.slug}/captains`} className="w-full">
                查看全部候选人 →
              </Link>
            </Btn>
          </Panel>
        ) : featured.status === "playing" ? (
          <Panel label="LIVE MATCHES">
            <div className="grid gap-3.5">
              <div>
                <div
                  className="uppercase"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--color-fg-dim)",
                    letterSpacing: "var(--tracking-label)",
                  }}
                >
                  {SEASON_STATUS_LABELS[featured.status]}
                </div>
                <div
                  className="mt-1 font-semibold"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 20,
                    color: "var(--color-fg)",
                  }}
                >
                  {featured.name}
                </div>
              </div>
              <div className="grid gap-2 py-3 border-y border-[var(--color-border)]">
                {liveAndUpcomingMatches.length > 0 ? (
                  liveAndUpcomingMatches.map((m) => (
                    <div key={m.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {m.status === "in_progress" && (
                          <span
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: 10,
                              color: "var(--color-ok)",
                              letterSpacing: "var(--tracking-label)",
                            }}
                          >
                            ● LIVE
                          </span>
                        )}
                        {m.status === "scheduled" && (
                          <span
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: 10,
                              color: "var(--color-fg-dim)",
                              letterSpacing: "var(--tracking-label)",
                            }}
                          >
                            NEXT
                          </span>
                        )}
                      </div>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          color: "var(--color-fg-mid)",
                        }}
                      >
                        {m.format.toUpperCase()}
                        {m.scheduledAt
                          ? ` · ${new Date(m.scheduledAt).toLocaleString("zh-CN", {
                              timeZone: "Asia/Shanghai",
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}`
                          : ""}
                      </span>
                    </div>
                  ))
                ) : (
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-fg-dim)" }}>
                    暂无进行中的比赛
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="TEAMS" value={featuredTeamCount?.value ?? 0} />
                <MiniStat label="PLAYERS" value={featuredPlayerCount?.value ?? 0} accent />
                <MiniStat label="STAGE" value={featured.status.toUpperCase()} />
              </div>
              <Btn full asChild>
                <Link href={`/${featured.slug}/matches`} className="w-full">
                  查看赛程 →
                </Link>
              </Btn>
            </div>
          </Panel>
        ) : (
          <Panel label="CURRENT SEASON">
            <div className="grid gap-3.5">
              <div>
                <div
                  className="uppercase"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--color-fg-dim)",
                    letterSpacing: "var(--tracking-label)",
                  }}
                >
                  {SEASON_STATUS_LABELS[featured.status]}
                </div>
                <div
                  className="mt-1 font-semibold"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 20,
                    color: "var(--color-fg)",
                  }}
                >
                  {featured.name}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill status={featured.status} />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--color-fg-mid)",
                  }}
                >
                  {featured.kind}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 py-3 border-y border-[var(--color-border)]">
                <MiniStat label="TEAMS" value={featuredTeamCount?.value ?? 0} />
                <MiniStat label="PLAYERS" value={featuredPlayerCount?.value ?? 0} accent />
                <MiniStat label="STAGE" value={featured.status.toUpperCase()} />
              </div>
              <Btn full asChild>
                <Link href={`/${featured.slug}`} className="w-full">
                  进入赛季 →
                </Link>
              </Btn>
            </div>
          </Panel>
        )}
      </div>

      {/* 分层导航 */}
      <div>
        <Marker num={1} sub="NAVIGATION">
          入口
        </Marker>

        {/* Tier 1：主行动入口 */}
        {tier1Entry && (
          <div className="mb-3">
            <Link href={tier1Entry.href as never} className="group block">
              <Panel
                className="transition-colors hover:border-[var(--color-border-hi)] border-l-[3px] border-l-[var(--color-accent)]"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--color-fg-dim)",
                        letterSpacing: "var(--tracking-label)",
                        marginBottom: 4,
                      }}
                    >
                      {tier1Entry.mono}
                    </div>
                    <div
                      className="font-semibold"
                      style={{
                        fontFamily: "var(--font-sans)",
                        fontSize: 18,
                        color: "var(--color-fg)",
                      }}
                    >
                      {tier1Entry.label}
                    </div>
                  </div>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 20,
                      color: "var(--color-accent)",
                    }}
                  >
                    →
                  </span>
                </div>
              </Panel>
            </Link>
          </div>
        )}

        {/* Tier 2：grid-cols-4 次要入口 */}
        {tier2Entries.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            {tier2Entries.map((tile) => (
              <Link key={tile.href} href={tile.href as never} className="group">
                <Panel className="transition-colors hover:border-[var(--color-border-hi)]">
                  <div
                    className="flex items-center gap-2 mb-1.5"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--color-fg-dim)",
                      letterSpacing: "var(--tracking-label)",
                    }}
                  >
                    {tile.mono}
                  </div>
                  <div
                    className="font-semibold"
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: 14,
                      color: "var(--color-fg)",
                    }}
                  >
                    {tile.label}
                  </div>
                </Panel>
              </Link>
            ))}
          </div>
        )}

        {/* Tier 3：紧凑按钮行 */}
        {tier3Entries.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {tier3Entries.map((tile) => (
              <Btn key={tile.href} ghost asChild>
                <Link href={tile.href as never}>{tile.label}</Link>
              </Btn>
            ))}
          </div>
        )}
      </div>

      {/* Other seasons */}
      {others.length > 0 && (
        <div>
          <Marker num={2} sub="MORE">
            其他赛季
          </Marker>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {others.map((s) => (
              <Link key={s.id} href={`/${s.slug}` as never}>
                <Panel className="transition-colors hover:border-[var(--color-border-hi)]">
                  <div className="flex items-center gap-2 mb-2">
                    <StatusPill status={s.status} />
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--color-fg-dim)",
                      }}
                    >
                      {s.kind}
                    </span>
                  </div>
                  <div
                    className="font-semibold"
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: 16,
                      color: "var(--color-fg)",
                    }}
                  >
                    {s.name}
                  </div>
                </Panel>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Archive */}
      {archivedSeasons.length > 0 && (
        <div>
          <Marker num={3} sub="ARCHIVE">
            历届赛季
          </Marker>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {archivedSeasons.map((s) => (
              <Link key={s.id} href={`/${s.slug}` as never}>
                <Panel className="transition-colors hover:border-[var(--color-border-hi)]">
                  <div className="flex items-center gap-2 mb-2">
                    <StatusPill status={s.status} />
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--color-fg-dim)",
                      }}
                    >
                      {s.kind}
                    </span>
                  </div>
                  <div
                    className="font-semibold"
                    style={{
                      fontFamily: "var(--font-sans)",
                      fontSize: 16,
                      color: "var(--color-fg)",
                    }}
                  >
                    {s.name}
                  </div>
                </Panel>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
