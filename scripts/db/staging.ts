import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildStagingEnvironment } from "./staging-environment";
import { runProtectedRemoteCommand } from "./remote";

const projectRoot = resolve(process.cwd());
const command = process.argv[2];

try {
  runProtectedRemoteCommand(command, {
    drizzleConfig: "drizzle.staging.config.ts",
    buildEnvironment: (options) => buildStagingEnvironment(stagingProcessEnvironment(), options),
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

/**
 * `.env.local` is deliberately ignored by Git. Only its explicitly named
 * staging password is read here; production URLs and other local app settings
 * never become migration inputs.
 */
function stagingProcessEnvironment(): NodeJS.ProcessEnv {
  if (process.env.RIVALHUB_STAGING_DB_PASSWORD?.trim()) return process.env;
  try {
    const line = readFileSync(resolve(projectRoot, ".env.local"), "utf8")
      .split(/\r?\n/)
      .find((value) => value.startsWith("RIVALHUB_STAGING_DB_PASSWORD="));
    const password = line?.slice("RIVALHUB_STAGING_DB_PASSWORD=".length).trim();
    return password ? { ...process.env, RIVALHUB_STAGING_DB_PASSWORD: password } : process.env;
  } catch {
    return process.env;
  }
}
