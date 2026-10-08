// Protect diagnostic ordering: a broken page must fail before its missing token
// times out. No database/provider mocks are used as business evidence here.
import { EventEmitter } from "node:events";
import type { Page, Response } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { navigateAndWaitForResponse } from "../../e2e/helpers/page-health";

const documentResponse = (status: number) => ({
  ok: () => status >= 200 && status < 300,
  status: () => status,
  url: () => "http://localhost:3000/season/matches/match",
}) as Response;

function browser(navigate: (events: EventEmitter) => Promise<Response>) {
  const events = new EventEmitter();
  return Object.assign(events, { goto: () => navigate(events) }) as unknown as Page;
}

afterEach(() => vi.useRealTimers());
describe("LIVE page health before token wait", () => {
  it("rejects HTTP 500 immediately and removes pending listeners/timers", async () => {
    vi.useFakeTimers();
    const page = browser(async () => documentResponse(500));
    await expect(navigateAndWaitForResponse(page, "/match", () => false)).rejects.toThrow("HTTP 500");
    expect(vi.getTimerCount()).toBe(0);
    expect((page as unknown as EventEmitter).eventNames()).toEqual([]);
  });
  it("reports a compilation error even with a successful streamed document", async () => {
    const page = browser(async events => {
      events.emit("pageerror", new Error("next/font/google queries have exactly one entry"));
      return documentResponse(200);
    });
    await expect(navigateAndWaitForResponse(page, "/match", () => false)).rejects.toThrow("Page compilation/runtime error: next/font/google");
  });
  it("captures a token arriving before navigation finishes", async () => {
    const token = documentResponse(200);
    const page = browser(async events => {
      events.emit("response", token);
      return documentResponse(200);
    });
    expect(await navigateAndWaitForResponse(page, "/match", r => r === token)).toBe(token);
  });
  it("does not let a received token conceal a failed document", async () => {
    const page = browser(async events => {
      events.emit("response", documentResponse(200));
      return documentResponse(500);
    });
    await expect(navigateAndWaitForResponse(page, "/match", () => true)).rejects.toThrow("HTTP 500");
  });
  it("retains the bounded missing-token failure for healthy pages", async () => {
    vi.useFakeTimers();
    const page = browser(async () => documentResponse(200));
    const outcome = expect(navigateAndWaitForResponse(page, "/match", () => false)).rejects.toThrow("Page loaded but expected response");
    await vi.advanceTimersByTimeAsync(30000);
    await outcome;
    expect(vi.getTimerCount()).toBe(0);
  });
});
