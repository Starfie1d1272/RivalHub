/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnstileWidget } from "@/components/auth/TurnstileWidget";

describe("TurnstileWidget", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
  });

  afterEach(() => {
    document.querySelectorAll('script[src*="challenges.cloudflare.com/turnstile"]').forEach((script) => script.remove());
    delete window.turnstile;
    delete window.onLoadTurnstile;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("forwards a safe challenge error code while preserving provider retry", () => {
    const onError = vi.fn();
    const renderMock = vi.fn().mockReturnValue("widget-1");
    vi.stubGlobal("turnstile", { render: renderMock, reset: vi.fn() });

    render(<TurnstileWidget onVerify={vi.fn()} onError={onError} />);
    const options = renderMock.mock.calls[0]?.[1] as {
      "error-callback": (errorCode?: string) => boolean | void;
    };

    expect(options["error-callback"]("110200")).toBe(false);
    expect(onError).toHaveBeenCalledWith({ kind: "challenge_error", errorCode: "110200" });
    options["error-callback"]("token=must-not-be-logged");
    expect(onError).toHaveBeenLastCalledWith({ kind: "challenge_error", errorCode: undefined });
  });

  it("reports an api.js resource failure separately", () => {
    const onError = vi.fn();
    delete window.turnstile;
    render(<TurnstileWidget onVerify={vi.fn()} onError={onError} />);

    const script = document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com/turnstile"]');
    expect(script).not.toBeNull();
    fireEvent.error(script!);

    expect(onError).toHaveBeenCalledWith({ kind: "script_load_error" });
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
