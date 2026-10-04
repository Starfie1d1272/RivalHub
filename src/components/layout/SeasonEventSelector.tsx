"use client";
import React from "react";
import { EventSelector, type EventOption } from "./EventSelector";
export function SeasonEventSelector({ events, value }: { events: EventOption[]; value: string }) {
  return <EventSelector events={events} value={value} hrefFor={(slug) => `/${slug}`} />;
}
