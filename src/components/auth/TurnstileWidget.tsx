"use client";

import { useEffect, useRef, useCallback } from "react";

interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  onError?: () => void;
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: string | HTMLElement, options: { sitekey: string; callback: (token: string) => void; "error-callback"?: () => void }) => string;
      reset: (id?: string) => void;
    };
    onLoadTurnstile?: () => void;
  }
}

export function TurnstileWidget({ onVerify, onError }: TurnstileWidgetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string>("");
  const onVerifyRef = useRef(onVerify);
  const onErrorRef = useRef(onError);

  useEffect(() => { onVerifyRef.current = onVerify; }, [onVerify]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const renderWidget = useCallback(() => {
    if (ref.current && window.turnstile) {
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
        callback: (token: string) => onVerifyRef.current(token),
        "error-callback": () => onErrorRef.current?.(),
      });
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

    const existingScript = document.querySelector(
      'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onLoadTurnstile"]'
    );
    if (!existingScript) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onLoadTurnstile";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    return () => {
      window.onLoadTurnstile = originalOnLoad;
    };
  }, [renderWidget]);

  return <div ref={ref} />;
}
