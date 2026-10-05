"use client";
import React from "react";
import { EventSelector, type EventOption } from "./EventSelector";
export function SeasonEventSelector({ events, value, currentName }: { events: EventOption[]; value: string; currentName?: string }) {
  return <EventSelector events={events} value={value} selectedName={currentName} hrefFor={(slug) => `/${slug}`} />;
}
