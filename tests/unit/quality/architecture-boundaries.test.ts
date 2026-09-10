import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { checkArchitecture } from "../../../scripts/architecture/check";

const eslint = new ESLint({ cwd: process.cwd() });

async function lintSource(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return result?.messages ?? [];
}

describe("architecture import boundaries", () => {
  it("passes the repository architecture graph", () => {
    expect(checkArchitecture()).toEqual([]);
  }, 15_000);

  it("resolves alias, relative, and dynamic imports in the client graph", () => {
    const violations = checkArchitecture({
      files: {
        "src/components/client.tsx": [
          '"use client";',
          'import "./relative-server";',
          'import("@/server-only-module");',
        ].join("\n"),
        "src/components/relative-server.ts": 'import "server-only";\n',
        "src/server-only-module.ts": 'import "server-only";\n',
      },
    });

    expect(violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: "ARCH_CLIENT_SERVER",
        file: "src/components/client.tsx",
        target: "src/server-only-module.ts",
        message: expect.stringContaining("use server"),
      }),
    ]));
    expect(violations).toHaveLength(2);
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

  it("allows server components and server libraries to use server APIs", () => {
    expect(checkArchitecture({
      files: {
        "src/app/page.tsx": 'import { db } from "@/db/client"; export default function Page() { void db; return null; }\n',
        "src/lib/server.ts": 'import { cache } from "react"; import { redirect } from "next/navigation"; export const load = cache(() => { void redirect; return null; });\n',
      },
    })).toEqual([]);
  });

  it("stops at a use server action boundary and ignores type-only edges", () => {
    const violations = checkArchitecture({
      files: {
        "src/components/client.tsx": [
          '"use client";',
          'import type { DB } from "@/db/client";',
          'import { type Secret } from "@/server-only-module";',
          'import { save } from "@/actions/save";',
          "void DB; void Secret; void save;",
        ].join("\n"),
        "src/actions/save.ts": [
          '"use server";',
          'import { db } from "@/db/client";',
          "void db;",
        ].join("\n"),
        "src/db/client.ts": 'import "server-only";\n',
        "src/server-only-module.ts": 'import "server-only";\n',
      },
    });

    expect(violations).toEqual([]);
  });

  it("rejects library dependencies on entrypoints, including dynamic imports", () => {
    const violations = checkArchitecture({
      files: {
        "src/lib/domain.ts": 'export async function load() { return import("../app/page"); }\n',
        "src/app/page.tsx": "export default function Page() { return null; }\n",
      },
    });

    expect(violations).toEqual([
      expect.objectContaining({
        ruleId: "ARCH_LIB_ENTRYPOINT",
        file: "src/lib/domain.ts",
        target: "src/app/page.tsx",
        message: expect.stringContaining("entrypoint"),
      }),
    ]);
  });

  it("enforces canonical third-party provider owners", () => {
    const violations = checkArchitecture({
      files: {
        "src/lib/standings/direct.ts": 'import("brackets-manager");\n',
        "src/lib/bracket/index.ts": 'import { BracketsManager } from "brackets-manager";\nvoid BracketsManager;\n',
        "src/lib/auth/supabase.ts": 'import { createClient } from "@supabase/supabase-js";\nvoid createClient;\n',
        "src/lib/standings/supabase.ts": 'import { createClient } from "@supabase/supabase-js";\nvoid createClient;\n',
      },
    });

    expect(violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "ARCH_CANONICAL_PROVIDER", file: "src/lib/standings/direct.ts", target: "brackets-manager" }),
      expect.objectContaining({ ruleId: "ARCH_CANONICAL_PROVIDER", file: "src/lib/standings/supabase.ts", target: "@supabase/supabase-js" }),
    ]));
    expect(violations).toHaveLength(2);
  });

  it("rejects direct brackets-manager imports outside the adapter", async () => {
    const messages = await lintSource(
      "src/lib/standings/direct-bracket-import.ts",
      'import { BracketsManager } from "brackets-manager";\nvoid BracketsManager;\n',
    );

    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: "no-restricted-imports",
        message: expect.stringContaining("@/lib/bracket"),
      }),
    ]));
  }, 15_000);

  it("allows the adapter to own the third-party import", async () => {
    const messages = await lintSource(
      "src/lib/bracket/direct-import.ts",
      'import { BracketsManager } from "brackets-manager";\nvoid BracketsManager;\n',
    );

    expect(messages.filter((message) => message.ruleId === "no-restricted-imports")).toHaveLength(0);
  });

  it("rejects direct database runtime imports outside the server-only facade", async () => {
    const messages = await lintSource(
      "src/lib/standings/direct-db-runtime-import.ts",
      'import { db } from "@/db/client-runtime";\nvoid db;\n',
    );

    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: "no-restricted-imports",
        message: expect.stringContaining("@/db/client"),
      }),
    ]));
  });

  it("rejects relative database runtime imports outside the server-only facade", async () => {
    const messages = await lintSource(
      "src/lib/standings/relative-db-runtime-import.ts",
      'import { db } from "../../db/client-runtime";\nvoid db;\n',
    );

    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ruleId: "no-restricted-imports",
        message: expect.stringContaining("canonical server-only @/db/client facade"),
      }),
    ]));
  });

  it("allows the server-only facade to import its runtime implementation", async () => {
    const messages = await lintSource(
      "src/db/client.ts",
      'import { db } from "./client-runtime";\nvoid db;\n',
    );

    expect(messages.filter((message) => message.ruleId === "no-restricted-imports")).toHaveLength(0);
  });
});
