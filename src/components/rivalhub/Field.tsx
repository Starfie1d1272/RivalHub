import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";
import type { InputHTMLAttributes } from "react";

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "className" | "value" | "type"> {
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
  ...rest
}: FieldProps) {
  return (
    <div>
      {label && (
        <Label
          htmlFor={rest.id}
          className="block mb-1.5 font-bold uppercase"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--color-fg-mid)",
            letterSpacing: "var(--tracking-label)",
          }}
        >
          {label}
        </Label>
      )}
      <Input
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
