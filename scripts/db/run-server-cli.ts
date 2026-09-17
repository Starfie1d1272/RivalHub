import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const [script, ...args] = process.argv.slice(2);
if (!script) throw new Error("缺少 server CLI script。");

const projectRoot = resolve(process.cwd());
const executable = resolve(projectRoot, `node_modules/.bin/tsx${process.platform === "win32" ? ".cmd" : ""}`);
const nodeOptions = [process.env.NODE_OPTIONS, "--conditions=react-server"].filter(Boolean).join(" ");
const result = spawnSync(executable, [script, ...args], {
  cwd: projectRoot,
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});
if (result.error) throw result.error;
if (result.signal) throw new Error(`${script} 被信号 ${result.signal} 终止。`);
process.exit(result.status ?? 1);
