import { spawn } from "node:child_process";
import { once } from "node:events";

// Test fixture timing only; preserve the canonical build/start and exit status.
const started = performance.now();
const mark = phase => console.info("PRODUCTION_STAGE", JSON.stringify({ phase, elapsedMs: performance.now() - started }));
let child;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child?.kill(signal));
mark("build.start");
child = spawn("pnpm", ["build:local"], { stdio: "inherit" });
const [buildCode] = await once(child, "exit");
if (buildCode !== 0) process.exit(buildCode ?? 1);
mark("build.complete");
child = spawn("pnpm", ["exec", "next", "start"], { stdio: ["inherit", "pipe", "inherit"], env: { ...process.env, NODE_ENV: "production" } });
let ready = false;
let output = "";
child.stdout.on("data", chunk => {
  process.stdout.write(chunk);
  output = (output + chunk.toString()).slice(-1024);
  if (!ready && /Ready in/.test(output)) { ready = true; mark("server.ready"); }
});
const [startCode] = await once(child, "exit");
process.exit(startCode ?? 1);
