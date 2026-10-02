import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/integrations/dak/events/route";
import { rivalHubEventsResponseSchema } from "@/lib/demo-integration/contracts";

const { authenticate, readEvents } = vi.hoisted(() => ({ authenticate: vi.fn(), readEvents: vi.fn() }));
vi.mock("@/lib/demo-integration/pairing", () => ({ authenticateDakRequest: authenticate }));
vi.mock("@/lib/demo-integration/read", () => ({ readRivalHubEvents: readEvents }));

// The published v1 parser rejects unknown series keys. Keep that constraint in
// the compatibility test, rather than testing only the new optional schema.
const eventSchema = rivalHubEventsResponseSchema.shape.events.element;
const legacySchema = rivalHubEventsResponseSchema.extend({
  events: eventSchema.extend({ series: eventSchema.shape.series.element.omit({ isForfeit: true }).array() }).array(),
});
const fixture = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/contracts/rivalhub-dak-events-1-disposition.json"), "utf8"));

beforeEach(() => {
  vi.clearAllMocks();
  authenticate.mockResolvedValue({ pairing: { seasonIds: [fixture.events[0].seasonId] } });
  readEvents.mockImplementation(async (_pairing, options) => {
    const response = structuredClone(fixture);
    if (!options.includeSeriesDisposition) {
      for (const event of response.events) for (const series of event.series) delete series.isForfeit;
    }
    return response;
  });
});

describe("DAK disposition negotiation", () => {
  it.each(["", "?seriesDisposition=0", "?seriesDisposition=true", "?other=1"])("keeps the strict legacy shape for %s", async (query) => {
    const request = new Request(`https://example.test/api/integrations/dak/events${query}`);
    const response = await GET(request);
    const body = await response.json();
    expect(authenticate).toHaveBeenCalledWith(request, "event:read");
    expect(readEvents).toHaveBeenCalledWith({ seasonIds: [fixture.events[0].seasonId] }, { includeSeriesDisposition: false });
    expect(legacySchema.safeParse(body).success).toBe(true);
    expect(rivalHubEventsResponseSchema.safeParse(body).success).toBe(true);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("projects disposition only for explicit opt-in, with private request-time delivery", async () => {
    const response = await GET(new Request("https://example.test/api/integrations/dak/events?seriesDisposition=1"));
    const body = await response.json();
    expect(readEvents).toHaveBeenCalledWith({ seasonIds: [fixture.events[0].seasonId] }, { includeSeriesDisposition: true });
    expect(rivalHubEventsResponseSchema.parse(body)).toEqual(fixture);
    expect(legacySchema.safeParse(body).success).toBe(false);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
