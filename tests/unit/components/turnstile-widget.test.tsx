/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TurnstileWidget } from "@/components/auth/TurnstileWidget";

describe("TurnstileWidget", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
  });

  it("resets a consumed token and clears it when the challenge expires", () => {
    const onVerify = vi.fn();
    const renderMock = vi.fn().mockReturnValue("widget-1");
    const resetMock = vi.fn();
    vi.stubGlobal("turnstile", { render: renderMock, reset: resetMock });

    const { rerender } = render(<TurnstileWidget onVerify={onVerify} resetSignal={0} />);
    const options = renderMock.mock.calls[0]?.[1] as {
      "expired-callback": () => void;
    };

    act(() => options["expired-callback"]());
    rerender(<TurnstileWidget onVerify={onVerify} resetSignal={1} />);

    expect(onVerify).toHaveBeenCalledWith("");
    expect(resetMock).toHaveBeenCalledWith("widget-1");
  });
});
