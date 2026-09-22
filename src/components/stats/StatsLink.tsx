import React from "react";
import Link from "next/link";
import type { ComponentProps } from "react";

type StatsLinkProps = Omit<ComponentProps<typeof Link>, "scroll">;

/** Keeps URL-driven stats navigation at the user's current reading position. */
export function StatsLink(props: StatsLinkProps) {
  return <Link {...props} scroll={false} />;
}
