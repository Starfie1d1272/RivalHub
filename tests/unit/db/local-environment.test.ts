import { describe, expect, it } from "vitest";
import {
  assertDeclaredDatabaseTarget,
  assertLocalDatabaseUrl,
  buildLocalAppEnvironment,
  parseLocalSupabaseStatus,
} from "../../../scripts/db/local-environment";

describe("local database target guard", () => {
  it.each([
    "postgresql://postgres:postgres@localhost:54322/postgres",
    "postgres://postgres:postgres@127.0.0.1:54322/postgres",
    "postgresql://postgres:postgres@[::1]:54322/postgres",
  ])("accepts an explicit loopback database URL: %s", (url) => {
    expect(assertLocalDatabaseUrl(url)).toBe(url);
  });

  it.each([
    undefined,
    "not-a-url",
    "https://127.0.0.1:54322/postgres",
    "postgresql://postgres:secret@db.example.com:5432/postgres",
    "postgresql://postgres:secret@aws-1-us-east-1.pooler.supabase.com:5432/postgres",
  ])("rejects a missing, malformed, non-Postgres, or remote target", (url) => {
    expect(() => assertLocalDatabaseUrl(url)).toThrow();
  });

  it("parses current and legacy Supabase status keys only after loopback validation", () => {
    expect(
      parseLocalSupabaseStatus(
        JSON.stringify({
          DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
          API_URL: "http://127.0.0.1:54321",
          PUBLISHABLE_KEY: "publishable-local",
          SERVICE_ROLE_KEY: "service-local",
          STUDIO_URL: "http://127.0.0.1:54323",
        }),
      ),
    ).toEqual({
      databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      apiUrl: "http://127.0.0.1:54321",
      publishableKey: "publishable-local",
      serviceRoleKey: "service-local",
      studioUrl: "http://127.0.0.1:54323",
    });

    expect(() =>
      parseLocalSupabaseStatus(
        JSON.stringify({
          DB_URL: "postgresql://postgres:secret@db.example.com:5432/postgres",
          API_URL: "https://example.supabase.co",
          ANON_KEY: "anon-remote",
          SERVICE_ROLE_KEY: "service-remote",
        }),
      ),
    ).toThrow(/必须指向/);
  });

  it("overrides inherited production variables with verified local values", () => {
    const env = buildLocalAppEnvironment(
      {
        databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        apiUrl: "http://127.0.0.1:54321",
        publishableKey: "publishable-local",
        serviceRoleKey: "service-local",
      },
      {
        DATABASE_URL: "postgresql://prod.example.com/prod",
        NEXT_PUBLIC_SUPABASE_URL: "https://prod.example.com",
      },
    );

    expect(env.DATABASE_URL).toContain("127.0.0.1:54322");
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(env.RIVALHUB_DB_TARGET).toBe("local");
  });

  it("requires an explicit remote target, exact host confirmation, and matching opt-in", () => {
    const databaseUrl = "postgresql://postgres:secret@staging.example.com:6543/postgres";
    expect(() => assertDeclaredDatabaseTarget({ DATABASE_URL: databaseUrl })).toThrow(
      /目标未声明/,
    );
    expect(() =>
      assertDeclaredDatabaseTarget({
        DATABASE_URL: databaseUrl,
        RIVALHUB_DB_TARGET: "staging",
        RIVALHUB_DB_HOST_CONFIRM: "other.example.com:6543",
        RIVALHUB_ALLOW_REMOTE_DB_WRITE: "staging",
      }),
    ).toThrow(/host:port/);
    expect(() =>
      assertDeclaredDatabaseTarget({
        DATABASE_URL: databaseUrl,
        RIVALHUB_DB_TARGET: "staging",
        RIVALHUB_DB_HOST_CONFIRM: "staging.example.com:6543",
        RIVALHUB_ALLOW_REMOTE_DB_WRITE: "production",
      }),
    ).toThrow(/未授权/);

    expect(() =>
      assertDeclaredDatabaseTarget({
        DATABASE_URL: databaseUrl,
        RIVALHUB_DB_TARGET: "staging",
        RIVALHUB_DB_HOST_CONFIRM: "staging.example.com:6543",
        RIVALHUB_ALLOW_REMOTE_DB_WRITE: "staging",
      }),
    ).not.toThrow();
  });
});
