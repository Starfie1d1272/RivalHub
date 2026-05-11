"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PRESET_COLORS = [
  "#f97316", "#3b82f6", "#22c55e", "#8b5cf6", "#ef4444", "#14b8a6",
];

interface ThemeColorPickerProps {
  value: string;
  onChange: (value: string) => void;
}

export function ThemeColorPicker({ value, onChange }: ThemeColorPickerProps) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className="w-8 h-8 rounded-full border-2 transition-transform hover:scale-110"
            style={{
              backgroundColor: color,
              borderColor: value === color ? "#fff" : "transparent",
              boxShadow: value === color ? `0 0 0 2px ${color}` : undefined,
            }}
            onClick={() => onChange(color)}
            aria-label={`选择主题色 ${color}`}
          />
        ))}
      </div>
      <div>
        <Label htmlFor="theme-color">自定义颜色</Label>
        <Input
          id="theme-color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#f97316"
        />
      </div>
    </div>
  );
}
