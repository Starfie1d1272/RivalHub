console.error(
  [
    "pnpm db:push 已禁用：它会绕过 active migration 中的 custom SQL、backfill 与 fail-closed validation。",
    "本地请使用 pnpm db:local:migrate 或 pnpm db:local:reset。",
    "远程 migration 必须先确认 staging 隔离和 baseline，再按 docs/deployment.md 执行 active migration chain。",
  ].join("\n"),
);
process.exit(1);
