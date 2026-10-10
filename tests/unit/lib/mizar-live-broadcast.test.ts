import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveBroadcastFetch } from "@/lib/mizar/live-broadcast";

afterEach(() => vi.unstubAllGlobals());
// Locked SDK + production adapter: unit evidence for status/body semantics.
// Real provider delivery and authorization remain owned by Realtime integration.
describe("LIVE broadcast failure evidence", () => {
  it.each([[202, "unknown"], [401, "auth"], [403, "auth"], [429, "rate_limited"], [500, "upstream"], [404, "endpoint"], [400, "request"]] as const)("retains HTTP %s while discarding a stalled body", async (status, reason) => {
    const cancelled = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"secret":"never-log')); }, cancel: cancelled });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => { expect(String(input)).toContain("127.0.0.1"); return new Response(body, { status }); });
    vi.stubGlobal("fetch", fetcher);
    const adapter = createLiveBroadcastFetch();
    const client = createClient("http://127.0.0.1:54321", "unit-key", { auth: { persistSession: false }, global: { fetch: adapter.fetch } });
    const channel = client.channel("match-live:unit", { config: { private: true } });
    await client.realtime.setAuth("unit-token");
    const send = channel.httpSend("snapshot", { safe: true }, { timeout: 20 });
    if (status === 202) await expect(send).resolves.toEqual({ success: true });
    else await expect(send).rejects.toThrow();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(adapter.evidence()).toEqual({ httpStatus: status, reason });
    expect(fetcher.mock.calls[0][0]).toContain("private=true");
    await client.removeChannel(channel);
  });
  it.each([["TimeoutError", "timeout"], ["TypeError", "transport"]] as const)("classifies %s without retaining error or credentials", async (name, reason) => {
    vi.stubGlobal("fetch", vi.fn(async () => { const error = new Error("Bearer sensitive-value"); error.name = name; throw error; }));
    const adapter = createLiveBroadcastFetch();
    await expect(adapter.fetch("http://127.0.0.1", {})).rejects.toThrow();
    expect(adapter.evidence()).toEqual({ httpStatus: undefined, reason });
    expect(JSON.stringify(adapter.evidence())).not.toContain("sensitive-value");
  });
});
