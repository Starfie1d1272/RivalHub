import { assertReleaseIdentity } from "@/lib/release/identity";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
};

export function GET(): Response {
  try {
    const identity = assertReleaseIdentity({
      releaseTag: process.env.RIVALHUB_RELEASE_TAG,
      releaseCommit: process.env.RIVALHUB_RELEASE_COMMIT,
    }, "production release identity");
    return Response.json(identity, { headers: NO_STORE_HEADERS });
  } catch {
    return Response.json(
      { error: "Production release identity unavailable." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
