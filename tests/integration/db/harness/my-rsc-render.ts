/** Runs in a separate real react-server request dispatcher, not a cache mock. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { db } from "../../../../src/db/client";
import { loadMyCompetitionContexts, loadTeamCompetitionContexts } from "../../../../src/lib/my/competitions";
import { assertLocalDatabaseUrl } from "../../../../scripts/db/local-environment";
import type { Pool } from "pg";
const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
const { renderToReadableStream } = require("next/dist/compiled/react-server-dom-webpack/server.node") as { renderToReadableStream: (value: unknown, manifest: object) => Promise<ReadableStream> };
async function main() {
  assertLocalDatabaseUrl(process.env.DATABASE_URL, "RSC memo fixture");
  const pool = (db as typeof db & { $client: Pool }).$client;
  const originalQuery = pool.query;
  let chains = 0;
  pool.query = function (this: Pool, ...args: unknown[]) {
    const statement = args[0];
    const sql = typeof statement === "string" ? statement : (statement as { text?: string })?.text;
    if (sql?.includes('from "event_roster_members"')) chains++;
    return Reflect.apply(originalQuery, this, args);
  } as typeof pool.query;
  const userId = randomUUID(); const teamId = randomUUID();
  async function Personal() { await loadMyCompetitionContexts(userId); return null; }
  async function Team() { await loadTeamCompetitionContexts(teamId, userId); return null; }
  try {
    for (let request = 1; request <= 2; request++) {
      const stream = await renderToReadableStream(React.createElement(React.Fragment, null, React.createElement(Personal), React.createElement(Team)), {});
      await new Response(stream).text();
      assert.equal(chains, request, "personal and team must share exactly one next-match chain per RSC request, never across requests");
    }
    process.stdout.write(JSON.stringify({ requests: 2, chains, dispatcher: "react-server-dom-webpack", database: "real-local-postgres" }));
  } finally { pool.query = originalQuery; await pool.end(); }
}
main().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
