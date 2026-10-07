import { EventLogo } from "@/components/season/EventLogo";
import React from "react";
import Link from "next/link";
import type { RegistrationMode, SeasonStatus } from "@/types/season";
import { APP_BRAND } from "@/lib/branding";
import type { HomeEyebrow } from "@/lib/home/navigation";
import { getRegistrationWindowState, type RegistrationWindowSeason } from "@/lib/registration/window";
import { Panel } from "@/components/rivalhub";
import { Button } from "@/components/ui/button";

interface HomeHeroSeason extends RegistrationWindowSeason {
  name: string;
  logoUrl?: string | null;
  slug: string;
  status: SeasonStatus;
  registrationMode: RegistrationMode;
  registrationOpenedAt?: Date | string | null;
}

interface HomeHeroProps {
  season: HomeHeroSeason;
  eyebrow: HomeEyebrow;
}

export function HomeHero({ season, eyebrow }: HomeHeroProps) {
  const registrationIsOpen = getRegistrationWindowState(season).canSubmit;

  return (
    <Panel className="overflow-hidden relative" contentClassName="p-0">
      <div className="p-7 relative z-10">
        <div
          className="mb-3 font-bold"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: eyebrow.color,
            letterSpacing: "var(--tracking-eyebrow)",
          }}
        >
          {eyebrow.text}
        </div>
        <h1
          className="font-semibold leading-[0.95] m-0 text-4xl lg:text-[56px]"
          style={{
            fontFamily: "var(--font-display)",
            letterSpacing: "var(--tracking-tight-2)",
            color: "var(--color-fg)",
          }}
        >
          {APP_BRAND.name}
          <br />
          <span className="inline-flex items-center gap-3" style={{ color: "var(--color-accent)" }}><EventLogo logoUrl={season.logoUrl ?? null} /><span>{season.name}</span></span>
        </h1>
        <div
          className="mt-3.5 max-w-[520px] leading-relaxed"
          style={{ color: "var(--color-fg-mid)", fontSize: 14 }}
        >
          {APP_BRAND.description}
        </div>
        <div className="flex gap-2.5 mt-5.5 flex-wrap">
          <Button asChild>
            <Link href={`/${season.slug}`}>进入赛事 →</Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/seasons">赛事中心</Link>
          </Button>
        </div>
      </div>
      <div
        aria-hidden
        className="absolute inset-0 opacity-50 pointer-events-none"
        style={{
          background: `
            radial-gradient(circle at 90% 10%, ${
              registrationIsOpen
                ? "var(--color-ok-soft)"
                : season.status === "registration" || season.status === "voting"
                  ? "var(--color-warn-soft)"
                  : "var(--color-accent-soft)"
            } 0, transparent 40%),
            repeating-linear-gradient(0deg, transparent 0 32px, color-mix(in srgb, var(--color-border) 25%, transparent) 32px 33px)
          `,
        }}
      />
    </Panel>
  );
}
