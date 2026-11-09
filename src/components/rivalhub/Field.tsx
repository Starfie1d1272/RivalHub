"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";
import { useId, type InputHTMLAttributes } from "react";

interface FieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "className" | "value" | "type"
> {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  mono?: boolean;
}

export function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  mono,
  id,
  ...rest
}: FieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div>
      {label && (
        <Label
          htmlFor={fieldId}
          className="mb-1.5 block text-xs font-medium text-[var(--color-fg-secondary)]"
        >
          {label}
        </Label>
      )}
      <Input
        id={fieldId}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(mono && "font-[family-name:var(--font-mono)]")}
        {...rest}
      />
    </div>
  );
}
