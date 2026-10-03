import { describe, expect, it } from "vitest";
import { readBoundedMizarJson } from "@/lib/mizar/http";

describe("LIVE request body budget", () => {
  it("cancels a disconnected/stalled body without waiting forever", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request("http://local.test", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expect(readBoundedMizarJson(request, 262144, 20)).rejects.toThrow(
      "body_timeout",
    );
    expect(cancelled).toBe(true);
  });
  it("bounds bytes even when content length is forged", async () => {
    const request = new Request("http://local.test", {
      method: "POST",
      headers: { "Content-Length": "1" },
      body: JSON.stringify({ x: "x".repeat(128) }),
    });
    await expect(readBoundedMizarJson(request, 64, 100)).rejects.toThrow(
      "payload_too_large",
    );
  });
});
