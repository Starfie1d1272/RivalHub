export const quiescenceSql: string;
export function waitForDatabaseQuiescence(client: {
  query(sql: string): Promise<{ rows: { transactions: number; prepared: number }[] }>;
}, options?: {
  timeoutMs?: number; intervalMs?: number; now?: () => number; wait?: (ms: number) => Promise<void>;
}): Promise<void>;
