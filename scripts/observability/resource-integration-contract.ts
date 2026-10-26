/** Local synthetic fixture adapter owned by G; A only schedules HTTP and observes. */
export interface ResourceHttpStep {
  operation: "live" | "reliable";
  authorityRevision: number;
  body(now: string): unknown;
  check(status: number, body: unknown): "accepted" | "discarded" | "canonicalized" | "duplicate" | "unknown";
}

export interface ResourceHttpFixture {
  publicPaths?: { lineup: string; team: string };
  reads?: readonly { family: "match" | "schedule"; path: string; credential: string }[];
  producers: readonly { credential: string; intervalMs: number; steps: readonly ResourceHttpStep[] }[];
  verify(requireReceipts?: boolean): Promise<Record<string, number | boolean>>;
  cleanup(): Promise<void>;
}

