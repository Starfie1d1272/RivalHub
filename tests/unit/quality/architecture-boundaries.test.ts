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

});
