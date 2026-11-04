import { RELEASE_TAG_PATTERN } from "../../src/lib/release/identity";

export type ReleaseEnvironment = Readonly<Record<string, string | undefined>>;

/** Production builds require the immutable tag and exact commit from the release workflow. */
export function assertProductionReleaseBuild(env: ReleaseEnvironment): void {
  if (env.VERCEL_ENV !== "production") return;

  const tag = env.RIVALHUB_RELEASE_TAG?.trim();
  const commit = env.RIVALHUB_RELEASE_COMMIT?.trim();
  if (!tag || !RELEASE_TAG_PATTERN.test(tag)) {
    throw new Error(
      "Production build 必须由 tag release workflow 发起；缺少有效 RIVALHUB_RELEASE_TAG。",
    );
  }
  if (!commit || !/^[0-9a-f]{40}$/i.test(commit)) {
    throw new Error(
      "Production build 必须携带 release commit SHA；缺少有效 RIVALHUB_RELEASE_COMMIT。",
    );
  }
}
