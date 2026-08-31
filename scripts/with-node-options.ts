import { spawnSync } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  throw new Error("缺少要执行的命令。");
}

const nodeOptions = [process.env.NODE_OPTIONS, "--dns-result-order=ipv4first"]
  .filter(Boolean)
  .join(" ");
const result = spawnSync(command, args, {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

if (result.error) throw result.error;
if (result.signal) throw new Error(`命令被信号 ${result.signal} 终止。`);
process.exit(result.status ?? 1);
