import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { expect, it } from "vitest";
it("shares next-match work only inside the real RSC request dispatcher", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", resolve("tests/integration/db/harness/my-rsc-render.ts")], { env: process.env, timeout: 20000 });
  expect(JSON.parse(stdout.trim().split("\n").at(-1)!)).toEqual({ requests: 2, chains: 2, dispatcher: "react-server-dom-webpack", database: "real-local-postgres" });
});
