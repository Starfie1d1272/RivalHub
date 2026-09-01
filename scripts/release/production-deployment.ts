export type ReleaseEnvironment = Readonly<Record<string, string | undefined>>;

const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Production Vercel builds are release-only. Git integration may still create
 * a production build attempt from main, but without the release workflow's
 * build marker it fails before reading production schema or running Next.js.
 */
export function assertProductionReleaseBuild(env: ReleaseEnvironment): void {
  if (env.VERCEL_ENV !== "production") return;

  const tag = env.RIVALHUB_RELEASE_TAG?.trim();
  const commit = env.RIVALHUB_RELEASE_COMMIT?.trim();
  if (!tag || !RELEASE_TAG_PATTERN.test(tag)) {
    throw new Error(
      "Vercel production deploy 必须由 tag release workflow 发起；缺少有效 RIVALHUB_RELEASE_TAG。",
    );
  }
  if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error(
      "Vercel production deploy 必须携带 release commit SHA；缺少有效 RIVALHUB_RELEASE_COMMIT。",
    );
  }
}
