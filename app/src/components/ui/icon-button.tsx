import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "./tooltip";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  active?: boolean;
  size?: "sm" | "md";
  tipAlign?: "center" | "start" | "end";
  tipSide?: "bottom" | "top" | "right";
}

/** Square icon button with a tooltip; the one style used by every toolbar. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, active, size = "md", tipAlign, tipSide, className, children, ...props },
  ref,
) {
  return (
    <Tooltip label={label} shortcut={shortcut} align={tipAlign} side={tipSide}>
      <button
        ref={ref}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "no-drag focus-ring inline-flex items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-foreground active:scale-95 disabled:pointer-events-none disabled:opacity-40",
          size === "md" ? "h-8 w-8" : "h-7 w-7",
          active && "bg-accent text-foreground",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  );
});
