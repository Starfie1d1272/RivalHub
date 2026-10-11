import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { claimBetReliefInTx, stakeBetInTx } from "@/lib/bet/service";
import { readBetRelief } from "@/lib/bet/relief-data";
import { fixture, read } from "./harness/bet-fixture";

// Model the historical reader-only build by lowering only its immutable JSON
// publication contract. This never enables a disabled producer and never mocks
// the guard or financial owner; the enabled suite uses the actual publisher1.
vi.mock("@/lib/bet/ledger-contract.json", () => ({ default: { readerVersion: 1, publisherVersion: 0 } }));

// The historical immutable publisher0 must block the real owner, including direct calls
// and historical replay, without losing the reader. Mocks cannot prove persistence.
it("publisher0 refuses direct and replay claims without account or ledger changes; reader1 retains relief", async () => fixture(async f => {
  const board = await read(f.db, f.seasonId, f.userId);
  const market = board.markets.find(m => m.type === "match_winner")!;
  await f.db.transaction(tx => stakeBetInTx(tx, {
    seasonId: f.seasonId, userId: f.userId, marketId: market.id,
    optionId: market.options[0]!.id, amount: "all", requestId: randomUUID(),
  }));
  const readEligibility = (userId: string) => f.db.transaction(tx => readBetRelief(tx, f.seasonId, userId), { accessMode: "read only", isolationLevel: "repeatable read" });
  const unjoinedId = randomUUID();
  await f.db.insert(schema.users).values({ id: unjoinedId, email: `${unjoinedId}@example.test`, emailVerifiedAt: new Date(), emailVerificationSource: "admin_migration" });
  const dto = await readEligibility(f.userId);
  expect(dto).toMatchObject({ canClaim: false, reason: "publication_unavailable", amount: "0", granted: "0", remaining: "100" });
  const emptyLedger = await f.db.select().from(schema.betLedger);
  await expect(f.db.transaction(tx => claimBetReliefInTx(tx, { seasonId: f.seasonId, userId: f.userId, day: dto.day }))).rejects.toThrow(/尚未开放/);
  expect(await f.db.select().from(schema.betLedger)).toEqual(emptyLedger);
  const account = await f.db.query.betAccounts.findFirst({ where: and(eq(schema.betAccounts.seasonId, f.seasonId), eq(schema.betAccounts.userId, f.userId)) });
  // Synthetic existing fact in an isolated DB, never emitted by the disabled owner.
  await f.db.insert(schema.betLedger).values({ seasonId: f.seasonId, accountId: account!.id, kind: "relief", source: `relief/${dto.day}`, amount: BigInt(7), profit: BigInt(0) });
  const beforeAccounts = await f.db.select().from(schema.betAccounts);
  const beforeLedger = await f.db.select().from(schema.betLedger);
  const attempts = await Promise.allSettled([f.userId, f.userId, unjoinedId].map(userId =>
    f.db.transaction(tx => claimBetReliefInTx(tx, { seasonId: f.seasonId, userId, day: dto.day }))));
  for (const attempt of attempts) {
    expect(attempt.status).toBe("rejected");
    if (attempt.status === "rejected") expect(attempt.reason.message).toMatch(/尚未开放/);
  }
  expect(await readEligibility(f.userId)).toMatchObject({ canClaim: false, amount: "0", granted: "7", remaining: "93", reason: "publication_unavailable" });
  expect(await readEligibility(unjoinedId)).toMatchObject({ canClaim: false, amount: "0" });
  const after = await read(f.db, f.seasonId, f.userId);
  expect(after).toMatchObject({ balance: "7", profit: "0", rank: null });
  expect(after.records).toEqual(expect.arrayContaining([expect.objectContaining({ label: "低保补给", amount: "7" })]));
  expect(await f.db.select().from(schema.betAccounts)).toEqual(beforeAccounts);
  expect(await f.db.select().from(schema.betLedger)).toEqual(beforeLedger);
}));
