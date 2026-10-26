import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

describe("CI slim registry adapter", () => {
  it("preserves digest, unrelated arguments, exit status and the digest-only mirror boundary", () => {
    const directory = mkdtempSync(join(tmpdir(), "slim-registry-"));
    try {
      const docker = join(directory, "docker");
      writeFileSync(docker, '#!/usr/bin/env bash\nprintf "%s\\n" "$@"\nexit 42\n');
      chmodSync(docker, 0o755);
      const pin = `postgres:17.11.0.004-r1@sha256:${"a".repeat(64)}`;
      const args = ["image", "inspect", `ghcr.io/supabase/cli/${pin}`, "--format", "{{.Id}}", "ghcr.io/supabase/cli/postgres:latest", `ghcr.io/other/${pin}`, "literal $value; $(command)"];
      const result = spawnSync("bash", [resolve("scripts/ci/slim-registry/docker"), ...args], {
        encoding: "utf8", env: { ...process.env, RIVALHUB_CI_DOCKER_BINARY: docker },
      });
      expect(result.status).toBe(42);
      expect(result.stdout.trimEnd().split("\n")).toEqual(args.map((value, index) => index === 2 ? `public.ecr.aws/supabase/cli/${pin}` : value));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
