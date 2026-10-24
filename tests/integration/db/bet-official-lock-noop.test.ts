import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import * as schema from "@/db/schema";
import { fixture } from "./harness/bet-fixture";

// Real triggers must keep the financial fence and outbox even when the market
// timestamp was already permanent. Transaction statistics count actual rewrites.
it.each(["before", "after"] as const)("preserves permanent fences and dirty while measuring market rewrites: %s", async version => fixture(async f => {
  await f.db.transaction(async tx => {
    if (version === "after") {
      const bindings = await tx.execute(sql`select c.relname as relation, t.tgname as trigger, p.proname as function,
        pg_get_triggerdef(t.oid) as binding, pg_get_functiondef(p.oid) as definition
        from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid
        where not t.tgisinternal and n.nspname='public' order by c.relname,t.tgname`);
      console.info("LOCK_TRIGGER_MATRIX", JSON.stringify(bindings.rows));
    }
    if (version === "before") await tx.execute(sql.raw(readFileSync(new URL("../../../drizzle/migrations/0082_bet-map-slots.sql", import.meta.url), "utf8").split("--> statement-breakpoint")[0]!));
    await tx.insert(schema.matchVetoSessions).values({ matchId: f.matchId, startedAt: sql`clock_timestamp()` });
    await tx.update(schema.matches).set({ gameplayStartedAt: sql`clock_timestamp()` }).where(eq(schema.matches.id, f.matchId));
    const locked = async () => (await tx.execute(sql`select id, locked_at::text as locked_at from bet_markets where season_id=${f.seasonId} and locked_at is not null order by id`)).rows;
    const before = await locked();
    expect(before.length).toBeGreaterThan(0);
    const rewrites = async () => Number((await tx.execute(sql`select coalesce(sum(n_tup_upd),0)::text as n from pg_stat_xact_user_tables where relname='bet_markets'`)).rows[0]!.n);
    const count = await rewrites();
    await tx.update(schema.betPrograms).set({ dirty: false }).where(eq(schema.betPrograms.seasonId, f.seasonId));
    await tx.update(schema.matchVetoSessions).set({ revision: 1 }).where(eq(schema.matchVetoSessions.matchId, f.matchId));
    await tx.update(schema.matches).set({ updatedAt: sql`clock_timestamp()` }).where(eq(schema.matches.id, f.matchId));
    if (version === "after") expect(await rewrites()).toBe(count);
    else expect(await rewrites()).toBeGreaterThan(count);
    expect(await locked()).toEqual(before);
    expect(await tx.query.betPrograms.findFirst({ where: eq(schema.betPrograms.seasonId, f.seasonId) })).toMatchObject({ dirty: true });
    console.info(JSON.stringify({ scenario: "locked-market-noop", version, lockedMarkets: before.length, subsequentMarketRewrites: (await rewrites()) - count, dirty: true }));
  });
}));
