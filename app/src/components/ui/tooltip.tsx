import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Kbd } from "./kbd";

/** Lightweight hover tooltip (CSS only). `align` keeps it on-screen near window edges. */
export function Tooltip({
  label,
  shortcut,
  side = "bottom",
  align = "center",
  children,
  className,
}: {
  label: ReactNode;
  shortcut?: string;
  side?: "bottom" | "top" | "right";
  align?: "center" | "start" | "end";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 flex items-center gap-1.5 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background opacity-0 shadow-md transition-opacity duration-100",
          "group-hover/tip:opacity-100 group-hover/tip:delay-500",
          side === "bottom" && "top-full mt-1.5",
          side === "top" && "bottom-full mb-1.5",
          side === "right" && "left-full top-1/2 ml-2 -translate-y-1/2",
          side !== "right" && align === "center" && "left-1/2 -translate-x-1/2",
          side !== "right" && align === "start" && "left-0",
          side !== "right" && align === "end" && "right-0",
        )}
      >
        {label}
        {shortcut && <Kbd inverted>{shortcut}</Kbd>}
      </span>
    </span>
  );
}
