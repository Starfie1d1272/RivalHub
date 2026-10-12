import { describe, expect, it } from "vitest";
import { checkArchitecture } from "../../../scripts/architecture/check";

describe("architecture import boundaries", () => {

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
