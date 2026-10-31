import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const key = process.env.LINUX_DEPLOY_SSH_KEY;
const knownHosts = process.env.LINUX_DEPLOY_KNOWN_HOSTS;
if (!key?.includes("PRIVATE KEY") || !knownHosts?.includes("[47.103.131.158]:52222")) throw new Error("Protected SSH configuration required");
const dir = mkdtempSync(join(tmpdir(), "rivalhub-host-readback-"));
try {
  writeFileSync(join(dir, "key"), `${key}\n`, { mode: 0o600 });
  writeFileSync(join(dir, "known_hosts"), `${knownHosts}\n`, { mode: 0o600 });
  let identity = null;
  try {
    const response = await fetch("https://match.starfie1d.top/api/system/release", { signal: AbortSignal.timeout(10000), redirect: "error" });
    if (!response.ok) throw new Error();
    const value = await response.json();
    if (Object.keys(value).sort().join(",") !== "releaseCommit,releaseTag" || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.releaseTag) || !/^[a-f0-9]{40}$/.test(value.releaseCommit)) throw new Error();
    identity = value;
  } catch { /* Canonical failure must not prevent host evidence. */ }
  console.log(JSON.stringify({ event: "linux.release_canonical_readback", identity }));
  const options = ["-i", join(dir, "key"), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${join(dir, "known_hosts")}`, "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2"];
  const output = execFileSync("ssh", [...options, "-p", "52222", "root@47.103.131.158", "/opt/rivalhub-production/current/runtime/node --input-type=module -"], {
    input: readFileSync("scripts/operations/release-host-readback.mjs"), encoding: "utf8", timeout: 60000, maxBuffer: 65536, stdio: ["pipe", "pipe", "inherit"],
  });
  const value = JSON.parse(output);
  if (value.event !== "linux.release_host_readback") throw new Error("Invalid host readback");
  console.log(JSON.stringify(value));
} finally { rmSync(dir, { recursive: true, force: true }); }
