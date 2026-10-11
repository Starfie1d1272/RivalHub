import { execFileSync } from "node:child_process";

export function assertReleaseCapabilities(cwd: string, previous: string, candidate: string): void {
  assertReaderFirstUpgrade(cwd, previous, candidate, "src/lib/bet/catalog-contract.json", 1, "BET catalog");
  assertReaderFirstUpgrade(cwd, previous, candidate, "src/lib/bet/ledger-contract.json", 0, "BET ledger");
  assertReaderFirstUpgrade(cwd, previous, candidate, "src/lib/matches/veto-room/lifecycle-contract.json", 0, "Veto lifecycle");
}

/** Immutable application capabilities independently require the shipped reader and a compatible rollback target. */
function assertReaderFirstUpgrade(cwd: string, previous: string, candidate: string, contractPath: string, missingVersion: number, label: string): void {
  type Version = { readerVersion: number; publisherVersion: number };
  type Contract = Version & { capabilities: Record<string, Version> };
  const read = (revision: string): Contract => {
    const present = execFileSync("git", ["ls-tree", "--name-only", revision, "--", contractPath], {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!present) return { readerVersion: missingVersion, publisherVersion: missingVersion, capabilities: {} };
    const value = JSON.parse(readGitFile(cwd, revision, contractPath)) as Record<string, unknown>;
    const { readerVersion, publisherVersion } = value ?? {};
    if (!Number.isInteger(readerVersion) || !Number.isInteger(publisherVersion)
      || Number(readerVersion) < missingVersion || Number(publisherVersion) < missingVersion || Number(readerVersion) < Number(publisherVersion)) {
      throw new Error(`${label} contract 无效：${revision}；release capability gate 拒绝继续。`);
    }
    const capabilities = Object.create(null) as Record<string, Version>;
    const declared = value.capabilities;
    if (declared !== undefined && (!declared || typeof declared !== "object" || Array.isArray(declared)))
      throw new Error(`${label} capabilities 无效：${revision}；release capability gate 拒绝继续。`);
    for (const [name, raw] of Object.entries(declared ?? {})) {
      const version = raw as Partial<Version> | null;
      if (!version || typeof version !== "object" || Array.isArray(version) ||
        !Number.isInteger(version.readerVersion) || !Number.isInteger(version.publisherVersion) ||
        Number(version.publisherVersion) < 0 || Number(version.readerVersion) < Number(version.publisherVersion))
        throw new Error(`${label} capability ${name} 无效：${revision}；release capability gate 拒绝继续。`);
      capabilities[name] = {readerVersion:Number(version.readerVersion),publisherVersion:Number(version.publisherVersion)};
    }
    return { readerVersion: Number(readerVersion), publisherVersion: Number(publisherVersion), capabilities };
  };
  const before = read(previous), after = read(candidate);
  if (after.publisherVersion > before.readerVersion || after.readerVersion < before.publisherVersion) {
    throw new Error(`${label} compatibility gate：previous Production reader/publisher v${before.readerVersion}/v${before.publisherVersion} 与 candidate reader/publisher v${after.readerVersion}/v${after.publisherVersion} 不兼容；必须先独立发布兼容读取版本，不能合并为一次发布或降级到不兼容版本。`);
  }
  // Independent capabilities must not accidentally share a publisher switch.
  // Missing declarations mean no reading/publication capability, including rollback targets.
  for (const name of new Set([...Object.keys(before.capabilities), ...Object.keys(after.capabilities)])) {
    const oldVersion = before.capabilities[name] ?? {readerVersion:0,publisherVersion:0};
    const newVersion = after.capabilities[name] ?? {readerVersion:0,publisherVersion:0};
    if (newVersion.publisherVersion > oldVersion.readerVersion || newVersion.readerVersion < oldVersion.publisherVersion)
      throw new Error(`${label} capability ${name} compatibility gate：必须先独立发布兼容读取版本，不能合并为一次发布或降级到不兼容版本。`);
  }
}

function readGitFile(cwd: string, revision: string, path: string): string {
  return execFileSync("git", ["show", `${revision}:${path}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
