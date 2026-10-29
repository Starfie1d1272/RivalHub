import { expect, it } from "vitest";
import { observePublicStatsFill } from "@/lib/stats/public-fill";
import { getRuntimeResourceSnapshot } from "@/lib/observability/runtime-resources";

const snapshot = () => getRuntimeResourceSnapshot().find(value => value.name === "stats.public.fill")!;

it("releases the shared resource after an asynchronous statistics failure", async () => {
  const before = snapshot();
  let reject!: (error: Error) => void;
  const pending = observePublicStatsFill("stats.fill", () => new Promise((_resolve, fail) => { reject = fail; }));
  expect(snapshot().inFlight).toBe(before.inFlight + 1);
  const failure = new Error("statistics dependency failed");
  reject(failure);
  await expect(pending).rejects.toBe(failure);
  expect(snapshot()).toMatchObject({ inFlight: before.inFlight, count: before.count + 1 });
});

it("does not retain a resource if the reader throws before returning a promise", async () => {
  const before = snapshot();
  const failure = new Error("reader failed synchronously");
  await expect(observePublicStatsFill("stats.fill", () => { throw failure; })).rejects.toBe(failure);
  expect(snapshot()).toMatchObject({ inFlight: before.inFlight, count: before.count + 1 });
});
