import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { ActivatedStatsOCRPanel } from "@/components/matches/ActivatedStatsOCRPanel";

const reads = vi.hoisted(() => vi.fn());
vi.mock("next/dynamic", () => ({ default: () => function Editor({ mapId }: { mapId: string }) {
  useEffect(() => { reads(mapId); }, [mapId]);
  return <input aria-label={`draft-${mapId}`} defaultValue="" />;
} }));
afterEach(() => { cleanup(); reads.mockClear(); });

it("does no hidden-map read and preserves a draft across close/reopen", async () => {
  const view = render(<ActivatedStatsOCRPanel mapId="one" mapName="de_nuke" initiallyOpen={false} summary="Map 1" />);
  expect(reads).not.toHaveBeenCalled();
  const details = view.container.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  const draft = await screen.findByLabelText("draft-one");
  fireEvent.change(draft, { target: { value: "unsaved" } });
  details.open = false;
  fireEvent(details, new Event("toggle"));
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(screen.getByLabelText("draft-one")).toHaveValue("unsaved");
  await waitFor(() => expect(reads).toHaveBeenCalledTimes(1));
});

it("loads the focused map immediately and keeps each map isolated", () => {
  render(<><ActivatedStatsOCRPanel mapId="one" mapName="de_nuke" initiallyOpen summary="Map 1" />
    <ActivatedStatsOCRPanel mapId="two" mapName="de_mirage" initiallyOpen={false} summary="Map 2" /></>);
  expect(reads).toHaveBeenCalledExactlyOnceWith("one");
  expect(screen.queryByLabelText("draft-two")).not.toBeInTheDocument();
});
