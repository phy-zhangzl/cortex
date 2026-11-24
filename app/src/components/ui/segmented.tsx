import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** macOS-style segmented control. */
export function Segmented<T extends string | number | boolean>({
  value,
  options,
  onChange,
  size = "sm",
  className,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={cn("no-drag inline-flex rounded-lg bg-muted p-0.5 ring-1 ring-inset ring-border/60", className)}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={String(option.value)}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "focus-ring flex-1 whitespace-nowrap rounded-md font-medium transition-[background-color,color,box-shadow] duration-150",
              size === "sm" ? "h-6 px-2.5 text-[11.5px]" : "h-7 px-3 text-xs",
              selected
                ? "bg-background text-foreground shadow-[0_1px_2px_hsl(var(--shadow-color)/0.12),0_0_0_0.5px_hsl(var(--border))]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
