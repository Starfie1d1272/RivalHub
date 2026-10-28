import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { createLocalPool } from "./harness/database";

const state = vi.hoisted(() => ({ database: null as unknown }));
vi.mock("@/db/client", () => ({ db: new Proxy({}, { get: (_, key) => Reflect.get(state.database as object, key) }) }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
// Statistics arithmetic and identity merge have independent real-PG contracts.
// This test isolates fresh profile SQL and its request composition from Next cache.
vi.mock("@/lib/stats/cached-query", () => ({ getPublicPlayerCareerDetail: async () => null }));
vi.mock("@/lib/seasons/public-results", () => ({ getPublicSeasonResults: async () => ({ placements: [], honors: [], honorHistory: [] }) }));
vi.mock("@/lib/observability/server", () => ({ captureException: () => {} }));

import { createPublicPlayerProfileSections } from "@/lib/players/public-profile";

it("keeps fresh education/entry withdrawal and multi-event history in independently consumed PG sections", async () => {
  const pool = createLocalPool();
  const client = await pool.connect();
  const queries: string[] = [];
  try {
    await client.query("BEGIN");
    for (const table of ["event_roster_members", "event_rosters", "competition_entries", "seasons", "education_verifications", "institutions"]) {
      await client.query(`CREATE TEMP TABLE ${table} ON COMMIT DROP AS SELECT * FROM public.${table} WITH NO DATA`);
    }
    state.database = drizzle(client, { schema, logger: { logQuery(query) { queries.push(query); } } });
    const userId = randomUUID();
    const institutionId = randomUUID();
    await client.query("INSERT INTO institutions (id,name) VALUES ($1,'Local public university')", [institutionId]);
    await client.query("INSERT INTO education_verifications (id,user_id,institution_id,status,academic_status,submitted_at) VALUES ($1,$2,$3,'approved','enrolled',now())", [randomUUID(), userId, institutionId]);
    for (const [index, status] of ["archived", "playing"].entries()) {
      const seasonId = randomUUID();
      const entryId = randomUUID();
      const rosterId = randomUUID();
      await client.query("INSERT INTO seasons (id,name,slug,status,created_at) VALUES ($1,$2,$2,$3,now())", [seasonId, `event-${index}`, status]);
      await client.query("INSERT INTO competition_entries (id,competition_id,name,registration_status) VALUES ($1,$2,$3,'approved')", [entryId, seasonId, `Entry ${index}`]);
      await client.query("INSERT INTO event_rosters (id,entry_id,status) VALUES ($1,$2,'frozen')", [rosterId, entryId]);
      await client.query("INSERT INTO event_roster_members (id,event_roster_id,user_id,is_current) VALUES ($1,$2,$3,true)", [randomUUID(), rosterId, userId]);
    }
    const known = { user: { id: userId }, sanctions: [] } as unknown as Parameters<typeof createPublicPlayerProfileSections>[0];
    const read = async () => {
      const sections = createPublicPlayerProfileSections(known);
      const [basic, history, overview, performance, attributes] = await Promise.all([
        sections.basic, sections.history, sections.overview, sections.performance, sections.attributes(),
      ]);
      return { basic, history, overview, performance, attributes };
    };
    const before = await read();
    expect(before.basic.publicEducationIdentities).toEqual([{ institutionName: "Local public university", academicStatus: "在读", verificationLabel: "已认证" }]);
    expect(before.basic.eventTeams).toHaveLength(2);
    expect(before.basic.currentEventTeams).toHaveLength(1);
    expect(before.history.careerHistory).toMatchObject([{ seasonSlug: "event-0", teamName: "Entry 0", record: { played: 0 } }]);
    expect(before.performance.statsUnavailable).toBe(true);
    expect(before.attributes).toEqual({ attributes: null, benchmarkUnavailable: false });
    expect(queries.filter(query => query.includes('from "event_roster_members"'))).toHaveLength(1);
    await client.query("UPDATE education_verifications SET status='rejected'");
    await client.query("UPDATE competition_entries SET registration_status='withdrawn'");
    const after = await read();
    expect(after.basic.publicEducationIdentities).toEqual([]);
    expect(after.basic.eventTeams).toEqual([]);
    expect(after.history.careerHistory).toEqual([]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
