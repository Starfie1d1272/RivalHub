import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { expect, it } from "vitest";
import {
  batchSummary,
  compressEvents,
} from "../../../workers/telemetry/storage";
import type { TelemetryEvent } from "@/lib/telemetry/protocol";
import { AnalysisData } from "@/lib/telemetry/analysis-contract";
import { ANALYSIS_BYTES_LIMIT } from "@/lib/telemetry/analysis-query";

// Independent protection: real D1 selection, the reader capability, privacy projection,
// and cross-batch correlation cannot be proved by a component or a mocked query.
it("analyzes real D1 batches with reader authorization, latest metric reports and correlated outcomes", async () => {
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve("tsx/package.json"))(
    "esbuild",
  ) as { build(options: object): Promise<{ outputFiles: { text: string }[] }> };
  const built = await build({
    entryPoints: ["workers/telemetry/index.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  const bindings = {
    SIGNING_KEY: "fixture-signing-key".repeat(3),
    ADMIN_KEY: "fixture-admin-key".repeat(3),
    DASHBOARD_KEY: "fixture-dashboard-key".repeat(3),
    ALLOWED_ORIGIN: "https://rivalhub.invalid",
  };
  const mf = new Miniflare({
    modules: true,
    script: built.outputFiles[0].text,
    compatibilityDate: "2026-07-30",
    bindings,
    d1Databases: ["DB"],
  });
  try {
    const db = await mf.getD1Database("DB");
    const schema = (await readFile("workers/telemetry/schema.sql", "utf8"))
      .replace(/^--.*$/gm, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch(schema.map((sql) => db.prepare(sql)));
    const now = Date.now();
    const id = (n: number) =>
      `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const rawSession = id(100);
    const base = {
      at: now - 500,
      session: rawSession,
      route: "/",
      scene: "site" as const,
    };
    const metric: TelemetryEvent = {
      ...base,
      id: id(10),
      kind: "performance",
      metricName: "INP",
      durationMs: 900,
    };
    const first: TelemetryEvent[] = [
      {
        ...base,
        id: id(1),
        kind: "page",
        navigation: "reload",
        client: {
          device: "mobile",
          browser: "safari",
          os: "ios",
          source: "none",
        },
      },
      {
        ...base,
        id: id(2),
        kind: "operation",
        operation: "auth.loginWithPassword",
        operationId: id(90),
        phase: "start",
      },
      metric,
      { ...metric, metricName: "FCP", durationMs: 20 },
      { ...base, id: id(3), kind: "filter", filters: { tab: "players" } },
      {
        ...base,
        id: id(4),
        kind: "error",
        errorCode: "CLIENT_UNHANDLED",
        requestId: id(80),
      },
    ];
    const second: TelemetryEvent[] = [
      first[0],
      { ...metric, at: now - 100, durationMs: 80 },
      {
        ...base,
        id: id(5),
        kind: "operation",
        operation: "auth.loginWithPassword",
        operationId: id(90),
        phase: "success",
        durationMs: 220,
      },
      {
        ...base,
        id: id(6),
        kind: "operation",
        operation: "auth.loginWithPassword",
        operationId: id(91),
        phase: "start",
      },
      {
        ...base,
        id: id(7),
        kind: "operation",
        operation: "auth.loginWithPassword",
        operationId: id(91),
        phase: "rejected",
        errorCode: "UNAUTHORIZED",
        durationMs: 50,
      },
    ];
    async function insert(
      key: string,
      events: TelemetryEvent[],
      received: number,
      environment = "production",
      expires = now + 600000,
      legacy = false,
      bytes = 1000,
    ) {
      const summary = JSON.parse(batchSummary(events)) as unknown[][];
      if (legacy) for (const row of summary) row.splice(11);
      await db
        .prepare("INSERT INTO batches VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(
          "private-ticket",
          key,
          received,
          expires,
          "2026-10-24",
          "private-account",
          rawSession,
          "user",
          "fixture-release",
          environment,
          bytes,
          new Uint8Array(await compressEvents(events)),
          JSON.stringify(summary),
        )
        .run();
    }
    await insert("first", first, now - 400);
    await insert("second", second, now - 50);
    await insert(
      "late-old",
      [{ ...metric, at: now - 200, durationMs: 400 }],
      now - 1,
    );
    await insert(
      "legacy",
      [{ ...metric, id: id(11), metricName: "LCP", durationMs: 1500 }],
      now - 40,
      "production",
      now + 600000,
      true,
    );
    await insert("preview", first, now - 10, "preview");
    await insert("expired", first, now - 10, "production", now - 1);
    const headers = { authorization: `Bearer ${bindings.DASHBOARD_KEY}` };
    expect(
      (await mf.dispatchFetch("https://worker.invalid/admin/analysis")).status,
    ).toBe(401);
    expect(
      (
        await mf.dispatchFetch("https://worker.invalid/admin/analysis", {
          method: "POST",
          headers,
        })
      ).status,
    ).toBe(405);
    for (const query of [
      "account=private-account",
      "session=private-session",
      "device=arbitrary",
      "route=/secret",
      "hours=999",
    ])
      expect(
        (
          await mf.dispatchFetch(
            `https://worker.invalid/admin/analysis?${query}`,
            { headers },
          )
        ).status,
      ).toBe(400);
    expect(
      (
        await mf.dispatchFetch(
          "https://worker.invalid/admin/events?session=" + rawSession,
          { headers },
        )
      ).status,
    ).toBe(401);
    const response = await mf.dispatchFetch(
      "https://worker.invalid/admin/analysis",
      { headers },
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("private-");
    expect(body).not.toContain(rawSession);
    expect(body).not.toContain("events_gzip");
    const data = AnalysisData.parse(JSON.parse(body));
    expect(data.meta.batches).toBe(4);
    expect(data.totals).toMatchObject({
      views: 1,
      sessions: 1,
      accounts: 1,
      starts: 2,
      success: 1,
      rejected: 1,
      pending: 0,
      errors: 1,
      legacyPerformance: 1,
    });
    expect(data.metrics.find((m) => m.key === "INP")).toMatchObject({
      n: 1,
      p50: 80,
      p75: 80,
      p95: 80,
    });
    expect(data.metrics.find((m) => m.key === "FCP")).toMatchObject({
      n: 1,
      p75: 20,
    });
    expect(data.navigation).toContainEqual({
      key: "reload",
      label: "刷新",
      n: 1,
      share: 100,
    });
    expect(data.filterRows[0]).toMatchObject({
      dimension: "tab",
      value: "players",
      n: 1,
    });
    expect(data.errorGroups).toHaveLength(2);
    const session = await mf.dispatchFetch(
      `https://worker.invalid/admin/analysis?session=${data.sessions[0].key}`,
      { headers },
    );
    expect(
      AnalysisData.parse(await session.json()).timeline.some(
        (e) => e.label === "密码登录" && e.phase === "成功",
      ),
    ).toBe(true);
    const mobile = await mf.dispatchFetch(
      "https://worker.invalid/admin/analysis?device=mobile",
      { headers },
    );
    expect(AnalysisData.parse(await mobile.json()).totals).toMatchObject({
      views: 1,
      starts: 0,
    });
    const empty = await mf.dispatchFetch(
      "https://worker.invalid/admin/analysis?route=/stats",
      { headers },
    );
    expect(AnalysisData.parse(await empty.json()).totals.views).toBe(0);
    await insert(
      "budget",
      first,
      now,
      "production",
      now + 600000,
      false,
      ANALYSIS_BYTES_LIMIT,
    );
    const bounded = AnalysisData.parse(
      await (
        await mf.dispatchFetch("https://worker.invalid/admin/analysis", {
          headers,
        })
      ).json(),
    );
    expect(bounded.meta).toMatchObject({ truncated: true, batches: 1 });
  } finally {
    await mf.dispose();
  }
}, 30000);

it("counts all result reports independently of the bounded issue list and started-call cohort", async () => {
  const { analyzeTelemetry } = await import("@/lib/telemetry/analysis-model");
  const { analysisDefaults } = await import("@/lib/telemetry/analysis-query");
  const now = Date.now();
  const common = { at: now - 1, received: now - 1, expires: now + 60000, session: "a".repeat(32), account: null, role: "anonymous", release: "fixture", route: "/", scene: "site", eventId: null, kind: "operation" };
  const events = Array.from({ length: 101 }, (_, i) => ({ ...common, id: `r${i}`, operationId: `op${i}`, operation: `operation${i}`, phase: "rejected" }));
  events.push({ ...common, id: "unknown", operationId: "unknown", operation: "unknown", phase: "unknown" });
  const data = analyzeTelemetry({ capturedAt: now, batches: 4, bytes: 20000, oldest: now - 1, events, metricIds: [], usage: { budget: { batches: 5000, bytes: 8388608 }, usage: [], expiredBatches: 0 }, truncated: false, validUntil: now + 60000 }, analysisDefaults);
  expect(data.errorGroups).toHaveLength(100);
  expect(data.totals).toMatchObject({ rejectedReports: 101, unknownReports: 1, rejected: 0, unknown: 0, resultOnly: 102 });
  expect(AnalysisData.parse(data).totals.rejectedReports).toBe(101);
});
