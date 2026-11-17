import { describe, expect, it } from "vitest";
import { checkArchitecture } from "../../../scripts/architecture/check";

describe("architecture import boundaries", () => {

  it("keeps SQL metrics out of presentation, including aliased imports", () => {
    const violations = checkArchitecture({ files: {
      "src/app/demo/page.tsx": 'import { count as rows } from "drizzle-orm"; void rows;',
      "src/components/Demo.tsx": 'const metric = sql`count(*) filter (where status = 1)`;',
      "src/lib/demo/read-model.ts": 'import { count } from "drizzle-orm"; void count;',
    } });
    expect(violations.filter(v => v.ruleId === "ARCH_PAGE_AGGREGATE").map(v => v.file)).toEqual([
      "src/app/demo/page.tsx", "src/components/Demo.tsx",
    ]);
  });

  it("rejects client access to database and server-owned facades", () => {
    const violations = checkArchitecture({
      files: {
        "src/components/client.tsx": [
          '"use client";',
          'import { db } from "@/db/client";',
          'import { createServiceClient } from "@/lib/auth/supabase-server";',
          'import { logEvent } from "@/lib/observability/server";',
          "void db; void createServiceClient; void logEvent;",
        ].join("\n"),
        "src/db/client.ts": 'import "server-only";\n',
        "src/lib/auth/supabase-server.ts": 'import "server-only";\n',
        "src/lib/observability/server.ts": 'import "server-only";\n',
      },
    });

    expect(violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "ARCH_CLIENT_SERVER", target: "src/db/client.ts" }),
      expect.objectContaining({ ruleId: "ARCH_CLIENT_SERVER", target: "src/lib/auth/supabase-server.ts" }),
      expect.objectContaining({ ruleId: "ARCH_CLIENT_SERVER", target: "src/lib/observability/server.ts" }),
    ]));
    expect(violations).toHaveLength(3);
  });

  it("checks relative and aliased value re-exports against the owner matrix", () => {
    const violations = checkArchitecture({ files: {
      "src/lib/identity/profile.ts": 'export { receipt } from "../mizar/reliable.mjs";',
      "src/lib/teams/team.ts": 'export * from "@/lib/mizar/reliable.mjs";',
      "src/lib/mizar/reliable.mjs": "export const receipt = {};",
    } });
    expect(violations.map(({ ruleId, file, target }) => [ruleId, file, target])).toEqual([
      ["ARCH_DOMAIN_DEPENDENCY", "src/lib/identity/profile.ts", "src/lib/mizar/reliable.mjs"],
      ["ARCH_DOMAIN_DEPENDENCY", "src/lib/teams/team.ts", "src/lib/mizar/reliable.mjs"],
    ]);
  });

  it("rejects a concrete cycle through otherwise allowed owners and a dynamic import", () => {
    const violations = checkArchitecture({ files: {
      "src/lib/matches/result.ts": 'export * from "@/lib/major/advance";',
      "src/lib/major/advance.ts": 'export const result = () => import(`../matches/result`);',
    } });
    expect(violations.map(({ ruleId, file }) => [ruleId, file])).toEqual([
      ["ARCH_RUNTIME_CYCLE", "src/lib/major/advance.ts"],
      ["ARCH_RUNTIME_CYCLE", "src/lib/matches/result.ts"],
    ]);
  });

  it("allows type edges, value contracts and a workflow without creating a runtime cycle", () => {
    expect(checkArchitecture({ files: {
      "src/lib/identity/profile.ts": [
        'export type { Receipt } from "@/lib/mizar/reliable";',
        'import { type Result } from "../matches/result";',
      ].join("\n"),
      "src/lib/matches/result.ts": 'import "@/lib/identity/profile"; export type Result = string;',
      "src/lib/mizar/reliable.ts": 'import "@/lib/matches/result"; export type Receipt = string;',
      "src/lib/identity/merge.ts": 'import "@/lib/matches/result";',
      "src/lib/seasons/config.ts": 'import "@/lib/formats/supported";',
      "src/lib/formats/supported.ts": "export const stages = [];",
      "src/lib/matches/unused.spec.mjs": 'import "./unknown";',
    } })).toEqual([]);
  });

  it("fails closed on opaque imports, missing local implementations and schema runtime barrels", () => {
    const violations = checkArchitecture({ files: {
      "src/lib/identity/profile.ts": 'export const load = (path: string) => import(path);',
      "src/lib/matches/room.cts": 'module.exports = require("../new-runtime/handler");',
      "src/db/schema/runtime.ts": 'import "@/lib/major/barrel";',
      "src/lib/major/barrel.ts": 'export * from "./advance";',
      "src/lib/major/advance.ts": "export const phase = 1;",
    } });
    expect(violations.map(({ ruleId, file }) => [ruleId, file])).toEqual([
      ["ARCH_SCHEMA_CONTRACT", "src/db/schema/runtime.ts"],
      ["ARCH_UNKNOWN_MODULE", "src/lib/identity/profile.ts"],
      ["ARCH_UNKNOWN_MODULE", "src/lib/matches/room.cts"],
    ]);
  });
});
