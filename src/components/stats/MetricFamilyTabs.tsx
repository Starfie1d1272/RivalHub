"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils/cn";

export interface MetricFamilyOption<Key extends string = string> {
  key: Key;
  label: string;
}

export function MetricFamilyTabs<Key extends string>({
  label,
  value,
  options,
  onChange,
  children,
  panelClassName,
}: {
  label: string;
  value: Key;
  options: readonly MetricFamilyOption<Key>[];
  onChange: (value: Key) => void;
  children: ReactNode;
  panelClassName?: string;
}) {
  return (
    <Tabs
      value={value}
      activationMode="manual"
      onValueChange={(next) => {
        const option = options.find(({ key }) => key === next);
        if (option) onChange(option.key);
      }}
    >
      <TabsList aria-label={label} appearance="underline">
        {options.map((option) => (
          <TabsTrigger key={option.key} value={option.key} appearance="underline">
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {options.map((option) => (
        <TabsContent key={option.key} value={option.key} className={cn("min-w-0", panelClassName)}>
          {option.key === value ? children : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}
