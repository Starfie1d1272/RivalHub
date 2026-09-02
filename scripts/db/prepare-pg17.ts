import { Client } from "pg";
import { pathToFileURL } from "node:url";
import { assertLocalDatabaseUrl } from "./local-environment";

export async function preparePg17Database(configuredUrl: string): Promise<void> {
  const databaseUrl = assertLocalDatabaseUrl(configuredUrl, "RIVALHUB_LOCAL_DATABASE_URL");
  const client = new Client({
    connectionString: databaseUrlFor(databaseUrl, "template1"),
    ssl: false,
  });

  try {
    await client.connect();
    const version = (await client.query<{ server_version_num: string }>("SHOW server_version_num")).rows[0]
      ?.server_version_num;
    if (!version?.startsWith("17")) {
      throw new Error(`PostgreSQL candidate 必须是 major 17；实际 server_version_num=${version ?? "missing"}。`);
    }

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
      END
      $$;
    `);

    const roles = await client.query<{ rolname: string; rolcanlogin: boolean }>(
      "SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname",
      [["anon", "authenticated"]],
    );
    if (
      roles.rows.length !== 2 ||
      roles.rows.some((role) => role.rolcanlogin) ||
      roles.rows.map((role) => role.rolname).join(",") !== "anon,authenticated"
    ) {
      throw new Error("PostgreSQL candidate 的 anon/authenticated 最小角色 contract 不完整。");
    }

    const uuidFunction = await client.query<{ function_name: string | null }>(
      "SELECT to_regprocedure('gen_random_uuid()')::text AS function_name",
    );
    if (!uuidFunction.rows[0]?.function_name) {
      throw new Error("PostgreSQL candidate 缺少 active migration 使用的 gen_random_uuid()。");
    }

    const extensions = await client.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname",
    );
    console.log(
      [
        `PostgreSQL 17 prerequisites passed: server_version_num=${version}`,
        "roles=anon,authenticated (NOLOGIN)",
        "required_extensions=none",
        `preexisting_optional_extensions=${extensions.rows.map((row) => row.extname).join(",") || "none"}`,
        `gen_random_uuid=${uuidFunction.rows[0].function_name}`,
      ].join("; "),
    );
  } finally {
    await client.end();
  }
}

function databaseUrlFor(configuredUrl: string, databaseName: string): string {
  const url = new URL(configuredUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function main(): Promise<void> {
  await preparePg17Database(
    process.env.RIVALHUB_LOCAL_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
