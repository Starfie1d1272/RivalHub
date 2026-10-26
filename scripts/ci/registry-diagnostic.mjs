import { spawnSync } from "node:child_process";

// Temporary read-only probe: tokens stay in memory; only public response metadata is emitted.
const repository = "supabase/cli/auth";
const digest = "sha256:7eb303831d170865840dbb3f9018b48561c988704ad1d9a2bafabb4e93e92da5";
const accept = "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json";
const emit = value => console.log("registry-probe", JSON.stringify(value));
const info = spawnSync("docker", ["info", "--format", "{{json .}}"], { encoding: "utf8", timeout: 3000 });
try {
  const data = JSON.parse(info.stdout);
  emit({ dockerVersion: data.ServerVersion, dockerHttpProxy: !!data.HTTPProxy, dockerHttpsProxy: !!data.HTTPSProxy, mirrorCount: data.RegistryConfig?.Mirrors?.length ?? 0,
    processHttpProxy: !!process.env.HTTP_PROXY, processHttpsProxy: !!process.env.HTTPS_PROXY });
} catch { emit({ dockerInfoAvailable: false }); }

await Promise.all(["ghcr.io", "public.ecr.aws"].map(async registry => {
  try {
    const tokenUrl = registry === "ghcr.io"
      ? `https://${registry}/token?service=ghcr.io&scope=repository:${repository}:pull`
      : `https://${registry}/token/?service=public.ecr.aws&scope=repository:${repository}:pull`;
    const auth = await fetch(tokenUrl, { signal: AbortSignal.timeout(5000) });
    emit({ registry, stage: "anonymous_token", status: auth.status });
    if (!auth.ok) return;
    const { token } = await auth.json();
    const read = async (path, method = "GET") => {
      const response = await fetch(`https://${registry}/v2/${repository}/${path}`, {
        method, headers: { Authorization: `Bearer ${token}`, Accept: accept }, signal: AbortSignal.timeout(5000),
      });
      const meta = { registry, path, method, status: response.status, finalHost: new URL(response.url).hostname,
        headers: Object.fromEntries(["server", "via", "retry-after", "ratelimit-limit", "ratelimit-remaining", "docker-distribution-api-version", "content-length"].map(key => [key, response.headers.get(key)])) };
      let body;
      if (method === "GET") {
        const text = await response.text();
        try { body = JSON.parse(text); } catch { /* Status and headers remain sufficient. */ }
        if (!response.ok) meta.errors = body?.errors?.map(error => ({ code: error.code, message: String(error.message).slice(0, 160) }));
      }
      emit(meta);
      return body;
    };
    let manifest = await read(`manifests/${digest}`);
    if (manifest?.manifests) {
      const platform = manifest.manifests.find(row => row.platform?.architecture === "amd64" && row.platform?.os === "linux");
      manifest = await read(`manifests/${platform.digest}`);
    }
    if (manifest?.config) await read(`blobs/${manifest.config.digest}`);
    if (manifest?.layers?.[0]) await read(`blobs/${manifest.layers[0].digest}`, "HEAD");
  } catch (error) { emit({ registry, error: error.name, code: error.cause?.code ?? null }); }
}));
