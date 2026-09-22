export const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export interface ReleaseIdentity {
  releaseTag: string;
  releaseCommit: string;
}

export function assertReleaseIdentity(value: unknown, label = "release identity"): ReleaseIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是 object。`);
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "releaseCommit" || keys[1] !== "releaseTag") {
    throw new Error(`${label} 只能包含 releaseTag 与 releaseCommit。`);
  }

  const releaseTag = record.releaseTag;
  const releaseCommit = record.releaseCommit;
  if (typeof releaseTag !== "string" || !RELEASE_TAG_PATTERN.test(releaseTag)) {
    throw new Error(`${label} releaseTag 无效。`);
  }
  if (typeof releaseCommit !== "string" || !/^[0-9a-f]{40}$/i.test(releaseCommit)) {
    throw new Error(`${label} releaseCommit 无效。`);
  }

  return { releaseTag, releaseCommit: releaseCommit.toLowerCase() };
}
