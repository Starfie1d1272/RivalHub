"use client";

import { useEffect, useRef, useCallback } from "react";

interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  onError?: (failure: TurnstileFailure) => void;
  resetSignal?: number;
}

export type TurnstileFailure =
  | { kind: "script_load_error" }
  | { kind: "challenge_error"; errorCode?: string }
  | { kind: "configuration_error"; errorCode: "missing_site_key" };

declare global {
  interface Window {
    turnstile?: {
      render: (el: string | HTMLElement, options: {
        sitekey: string;
        appearance?: "always" | "execute" | "interaction-only";
        callback: (token: string) => void;
        "error-callback"?: (errorCode?: string) => boolean | void;
        "expired-callback"?: () => void;
      }) => string;
      reset: (id?: string) => void;
    };
    onLoadTurnstile?: () => void;
  }
}

const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onLoadTurnstile";

function safeErrorCode(value: string | undefined): string | undefined {
  const code = value?.trim();
  return code && /^[A-Za-z0-9_.:-]{1,100}$/.test(code) ? code : undefined;
}

export function TurnstileWidget({ onVerify, onError, resetSignal = 0 }: TurnstileWidgetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string>("");
  const onVerifyRef = useRef(onVerify);
  const onErrorRef = useRef(onError);

  useEffect(() => { onVerifyRef.current = onVerify; }, [onVerify]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const renderWidget = useCallback(() => {
    if (!ref.current || !window.turnstile) return;
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!siteKey) {
      onErrorRef.current?.({ kind: "configuration_error", errorCode: "missing_site_key" });
      return;
    }
    widgetId.current = window.turnstile.render(ref.current, {
      sitekey: siteKey,
      appearance: "interaction-only",
      callback: (token: string) => onVerifyRef.current(token),
      "error-callback": (errorCode?: string) => {
        onErrorRef.current?.({ kind: "challenge_error", errorCode: safeErrorCode(errorCode) });
        return false;
      },
      "expired-callback": () => onVerifyRef.current(""),
    });
  }, []);

  const resetWidget = useCallback(() => {
    if (widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current);
    }
  }, []);

  useEffect(() => {
    if (window.turnstile) {
      renderWidget();
      return;
    }

    const originalOnLoad = window.onLoadTurnstile;
    window.onLoadTurnstile = () => {
      originalOnLoad?.();
      renderWidget();
    };

    let script = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
    const handleScriptError = () => onErrorRef.current?.({ kind: "script_load_error" });
    if (!script) {
      script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.addEventListener("error", handleScriptError);
      document.head.appendChild(script);
    } else {
      script.addEventListener("error", handleScriptError);
    }

    return () => {
      window.onLoadTurnstile = originalOnLoad;
      script?.removeEventListener("error", handleScriptError);
    };
  }, [renderWidget]);

  useEffect(() => {
    if (resetSignal > 0) resetWidget();
  }, [resetSignal, resetWidget]);

  return <div ref={ref} />;
}
