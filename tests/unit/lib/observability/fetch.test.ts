import { describe, expect, it, vi } from "vitest";
import { providerFetch } from "@/lib/observability/fetch";

describe("provider fetch boundary", () => {
  it("marks provider requests as ignored and disables trace propagation", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    await providerFetch("turnstile")("https://provider.example.test/verify?token=private", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://provider.example.test/verify?token=private",
      expect.objectContaining({
        method: "POST",
        opentelemetry: {
          ignore: true,
          propagateContext: false,
          spanName: "provider.turnstile",
        },
      }),
    );
    vi.unstubAllGlobals();
  });
});
