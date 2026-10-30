import { EventEmitter } from "node:events";
import type { PoolClient } from "pg";
import { expect, it, vi } from "vitest";
import { bindPgQuery, capturePgQuery, observePgTraffic, preparePgTraffic, settlePgTraffic } from "@/lib/observability/pg-traffic-adapter";

it("excludes a pre-connect prefix across chunks and attributes later messages in the same chunk", () => {
  const stream = new EventEmitter();
  const attach = vi.fn(function (this: unknown, stream: EventEmitter) { void stream; return this; });
  const connection = Object.assign(new EventEmitter(), { attachListeners: attach });
  const client = Object.assign(new EventEmitter(), { connection, _activeQuery: null as object | null, _queryQueue: [], _sentQueryQueue: [], pipeline: false });
  const pg = client as unknown as PoolClient;
  preparePgTraffic(pg);
  expect(connection.attachListeners(stream)).toBe(connection);
  expect(attach).toHaveBeenCalledWith(stream);
  // One completed 6-byte ReadyForQuery and a nine-byte prefix of a notice.
  stream.emit("data", Buffer.alloc(15)); connection.emit("message", { name: "readyForQuery", length: 5 });
  let raw = 0; const classified: Array<[unknown, number]> = [];
  expect(observePgTraffic(pg, { enabled: () => true, raw: n => { raw += n; }, attribute: (owner, n) => { classified.push([owner, n]); } })).toBe(true);
  const before = capturePgQuery(pg); client._activeQuery = {}; bindPgQuery(pg, before, { source: "mizar", template: "q0000000000000000" });
  // Eleven bytes finish the old notice; ten belong to a new query message.
  stream.emit("data", Buffer.alloc(21));
  connection.emit("message", { name: "notice", length: 19 });
  connection.emit("message", { name: "commandComplete", length: 9 });
  expect(raw).toBe(21);
  expect(classified).toEqual([["async", 11], [{ source: "mizar", template: "q0000000000000000" }, 10]]);
});

it("attaches only to the stream selected by pg, preserving TLS stream selection and partial settlement", () => {
  const rawSocket = new EventEmitter(); const tlsStream = new EventEmitter();
  const connection = Object.assign(new EventEmitter(), { attachListeners: vi.fn() });
  const client = Object.assign(new EventEmitter(), { connection, _activeQuery: null, _queryQueue: [], _sentQueryQueue: [] });
  const pg = client as unknown as PoolClient; preparePgTraffic(pg);
  connection.attachListeners(tlsStream);
  let raw = 0; const classified: Array<[unknown, number]> = [];
  expect(observePgTraffic(pg, { enabled: () => true, raw: n => { raw += n; }, attribute: (owner, n) => { classified.push([owner, n]); } })).toBe(true);
  rawSocket.emit("data", Buffer.alloc(30)); tlsStream.emit("data", Buffer.alloc(3)); settlePgTraffic(pg);
  tlsStream.emit("data", Buffer.alloc(7)); connection.emit("message", { name: "commandComplete", length: 9 });
  expect(raw).toBe(10);
  expect(classified).toEqual([["partial", 3], ["no_owner", 7]]);
});

it("keeps counting received bytes as instrumentation if the message contract is unavailable", () => {
  const stream = new EventEmitter();
  const connection = Object.assign(new EventEmitter(), { attachListeners: vi.fn() });
  const client = Object.assign(new EventEmitter(), { connection, _activeQuery: null, _queryQueue: [], _sentQueryQueue: [] });
  const pg = client as unknown as PoolClient; preparePgTraffic(pg); connection.attachListeners(stream);
  let raw = 0; const classified: Array<[unknown, number]> = [];
  expect(observePgTraffic(pg, { enabled: () => true, raw: n => { raw += n; }, attribute: (owner, n) => { classified.push([owner, n]); } })).toBe(true);
  stream.emit("data", Buffer.alloc(6)); connection.emit("message", { name: "invalid" });
  stream.emit("data", Buffer.alloc(7));
  expect(raw).toBe(13);
  expect(classified).toEqual([["instrumentation", 6], ["instrumentation", 7]]);
});

it("keeps bytes for partial settlement on instrumentation errors and stops attribution after a length mismatch", () => {
  const stream = new EventEmitter();
  const connection = Object.assign(new EventEmitter(), { attachListeners: vi.fn() });
  const client = Object.assign(new EventEmitter(), { connection, _activeQuery: null, _queryQueue: [], _sentQueryQueue: [] });
  const pg = client as unknown as PoolClient; preparePgTraffic(pg); connection.attachListeners(stream);
  let raw = 0; const classified: Array<[unknown, number]> = [];
  expect(observePgTraffic(pg, { enabled: () => true, raw: n => { raw += n; }, attribute: (owner, n) => { if (owner === "instrumentation") throw Error("fixture"); classified.push([owner, n]); } })).toBe(true);
  stream.emit("data", Buffer.alloc(6)); connection.emit("message", { name: "commandComplete", length: 9 });
  stream.emit("data", Buffer.alloc(7)); settlePgTraffic(pg);
  expect(raw).toBe(13);
  expect(classified).toEqual([["partial", 13]]);
});
