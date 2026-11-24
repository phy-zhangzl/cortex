import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Kbd({ children, inverted }: { children: ReactNode; inverted?: boolean }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 font-sans text-[10px] font-medium",
        inverted ? "bg-background/20 text-background" : "border border-border bg-muted text-muted-foreground shadow-[0_1px_0_hsl(var(--border))]",
      )}
    >
      {children}
    </kbd>
  );
}
