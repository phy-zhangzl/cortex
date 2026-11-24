import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/** Panel anchored under a trigger element; closes on outside click / Escape. */
export function Popover({
  anchor,
  open,
  onClose,
  align = "end",
  className,
  children,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  align?: "start" | "end";
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const rect = anchor.current.getBoundingClientRect();
    setPos(
      align === "end"
        ? { top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) }
        : { top: rect.bottom + 6, left: Math.max(8, rect.left) },
    );
  }, [open, anchor, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, anchor]);

  if (!open || !pos) return null;
  return createPortal(
    <div
      ref={ref}
      style={pos}
      className={cn(
        "no-drag fixed z-50 rounded-xl bg-popover p-1.5 text-popover-foreground shadow-pop animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-100",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

export function PopoverItem({
  icon,
  label,
  hint,
  onSelect,
  danger,
  disabled,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors hover:bg-accent disabled:opacity-40",
        danger ? "text-destructive hover:bg-destructive/10" : "text-foreground",
      )}
    >
      {icon && <span className="flex h-4 w-4 items-center justify-center text-muted-foreground">{icon}</span>}
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </button>
  );
}

export function PopoverSeparator() {
  return <div className="mx-2 my-1 h-px bg-border" />;
}
