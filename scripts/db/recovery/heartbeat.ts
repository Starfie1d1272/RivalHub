const BETTER_STACK_ORIGIN = "https://uptime.betterstack.com";
const HEARTBEAT_PATH = /^\/api\/v1\/heartbeat\/[A-Za-z0-9_-]+$/;
export const BACKUP_HEARTBEAT_TIMEOUT_MS = 10_000;

export function assertBackupHeartbeatUrl(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(required(value));
  } catch {
    throw new Error("RIVALHUB_BACKUP_HEARTBEAT_URL 必须是 Better Stack heartbeat HTTPS URL。 ");
  }
  if (
    url.origin !== BETTER_STACK_ORIGIN
    || !HEARTBEAT_PATH.test(url.pathname)
    || url.search
    || url.hash
    || url.username
    || url.password
  ) {
    throw new Error("RIVALHUB_BACKUP_HEARTBEAT_URL 必须指向固定 Better Stack heartbeat endpoint。 ");
  }
  return url.toString().replace(/\/$/, "");
}

export async function sendBackupHeartbeat(
  heartbeatUrl: string,
  status: "success" | "failure",
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const target = status === "failure" ? `${heartbeatUrl}/fail` : heartbeatUrl;
  try {
    const response = await fetchImpl(target, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(BACKUP_HEARTBEAT_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error("heartbeat rejected");
  } catch {
    throw new Error(`Better Stack ${status} heartbeat failed; recovery backup status is not trusted. `);
  }
}

function required(value: string | undefined): string {
  if (!value?.trim()) throw new Error("RIVALHUB_BACKUP_HEARTBEAT_URL 未设置；拒绝继续。 ");
  return value.trim();
}
