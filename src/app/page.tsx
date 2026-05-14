export const dynamic = "force-dynamic";

import Link from "next/link";
import { and, eq, not } from "drizzle-orm";
import { db } from "@/db/client";
import { seasons } from "@/db/schema";
import { APP_BRAND } from "@/lib/branding";
import { SEASON_STATUS_LABELS } from "@/types/season";
import { Panel, Btn, Marker, StatusPill, EmptyState } from "@/components/rivalhub";

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
      <div className="mx-auto px-9 py-8 max-w-[1240px]">
        <Panel>
          <EmptyState
            title="暂无进行中的赛季"
            sub="请通过管理后台创建赛季。"
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto px-9 py-8 max-w-[1240px] grid gap-7">
      {/* Hero */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-[1.6fr_1fr]">
        <Panel className="overflow-hidden relative" pad={0}>
          <div className="p-7 relative z-10">
            <div
              className="mb-3 font-bold"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-accent)",
                letterSpacing: "var(--tracking-eyebrow)",
              }}
            >
              [ RIVALHUB / {featured.slug.replace(/-/g, " ").toUpperCase()} ]
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
            className="absolute inset-0 opacity-50"
            style={{
              background: `
                radial-gradient(circle at 90% 10%, #ff6b1a22 0, transparent 40%),
                repeating-linear-gradient(0deg, transparent 0 32px, #1f253040 32px 33px)
              `,
            }}
          />
        </Panel>

        {/* LIVE Panel */}
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
            <Btn full asChild>
              <Link href={`/${featured.slug}`} className="w-full">
                进入赛季 →
              </Link>
            </Btn>
          </div>
        </Panel>
      </div>

      {/* Nav tiles */}
      <div>
        <Marker num={1} sub="NAVIGATION">
          入口
        </Marker>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { href: `/${featured.slug}/register`, label: "报名参赛", mono: "REGISTER", meta: "个人报名" },
            { href: `/${featured.slug}/captains`, label: "队长投票", mono: "CAPTAINS", meta: "实时票数" },
            { href: `/${featured.slug}/draft`, label: "选秀直播间", mono: "DRAFT ROOM", meta: "● LIVE" },
            { href: `/${featured.slug}/teams`, label: "战队阵容", mono: "TEAMS", meta: "8 支战队" },
            { href: `/${featured.slug}/matches`, label: "赛程", mono: "MATCHES", meta: "Bracket · 赛果" },
            { href: `/${featured.slug}/stats`, label: "数据排行", mono: "STATS", meta: "Rating · ADR" },
            { href: "/seasons", label: "历史赛季", mono: "ARCHIVE", meta: "浏览回顾" },
            { href: "/login", label: "登录后台", mono: "LOGIN", meta: "管理员 · 队长" },
          ].map((tile) => (
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
    </div>
  );
}
