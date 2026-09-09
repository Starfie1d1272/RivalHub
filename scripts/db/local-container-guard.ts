const LOCAL_CONTAINER_OVERRIDE = "RIVALHUB_ALLOW_LOCAL_CONTAINERS";

export function assertLocalContainerAccess(
  command: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (env.CI === "true" || env[LOCAL_CONTAINER_OVERRIDE] === "1") return;

  throw new Error(
    [
      `命令 ${command} 需要本地 PostgreSQL / Supabase service evidence。`,
      "普通本地环境默认拒绝启动或使用容器服务；请让 GitHub Actions 提供重型证据，",
      `或明确设置 ${LOCAL_CONTAINER_OVERRIDE}=1 作为人工 override。`,
    ].join(" "),
  );
}
