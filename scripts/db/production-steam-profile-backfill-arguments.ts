const BACKFILL_RUNNER = [
  "scripts/db/run-server-cli.ts",
  "scripts/db/steam-profile-backfill.ts",
] as const;

export interface ProductionBackfillInvocation {
  apply: boolean;
  args: string[];
}

/**
 * pnpm can preserve an explicit argument separator as a literal "--".
 * The protected wrapper owns that transport detail; the inner backfill parser
 * should only receive its documented flags.
 */
export function buildProductionBackfillInvocation(argv: readonly string[]): ProductionBackfillInvocation {
  let firstArgument = 0;
  while (argv[firstArgument] === "--") firstArgument += 1;
  const forwardedArguments = argv.slice(firstArgument);

  return {
    apply: forwardedArguments.includes("--apply"),
    args: [...BACKFILL_RUNNER, ...forwardedArguments],
  };
}
