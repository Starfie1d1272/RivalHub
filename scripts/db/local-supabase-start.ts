import { spawnSync } from "node:child_process";

/** CLI pre-pull finishes before container creation; retries reuse downloaded image layers. */
export function runSupabaseStartup(executable: string, args: readonly string[], env: NodeJS.ProcessEnv): void {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = spawnSync(executable, [...args], {
      cwd: process.cwd(), env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`命令被信号 ${result.signal} 终止。`);
    if (result.status === 0) return;
    const stderr = result.stderr.trim();
    const rateLimited = /failed to pull docker image from all registries:/i.test(stderr)
      && /toomanyrequests/i.test(stderr)
      && !/unauthorized|denied|manifest unknown|invalid reference format/i.test(stderr);
    if (rateLimited && attempt < 2) {
      console.warn(`Local Supabase image pull rate limited; retrying startup (${attempt + 2}/3).`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000 * (attempt + 1));
      continue;
    }
    // Preserve the final resolver error when progress fills the bounded excerpt.
    const detail = stderr.length <= 2000 ? stderr : `${stderr.slice(0, 900)}\n…\n${stderr.slice(-1000)}`;
    throw new Error(`Local Supabase 启动失败（exit ${result.status ?? "unknown"}）${detail ? `：${detail}` : ""}`);
  }
}
