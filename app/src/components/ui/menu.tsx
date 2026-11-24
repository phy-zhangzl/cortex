import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { PopoverItem, PopoverSeparator } from "./popover";

export type MenuItem =
  | { label: string; onSelect: () => void; danger?: boolean; icon?: React.ReactNode }
  | { separator: true };

/** Context menu at a screen position (right-click / ⋯ buttons). */
export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const height = items.length * 32 + 12;
  return createPortal(
    <div
      ref={ref}
      className="no-drag fixed z-50 min-w-[180px] rounded-xl bg-popover p-1.5 shadow-pop animate-in fade-in-0 zoom-in-95 duration-100"
      style={{ left: Math.min(x, window.innerWidth - 196), top: Math.min(y, window.innerHeight - height - 8) }}
    >
      {items.map((item, i) =>
        "separator" in item ? (
          <PopoverSeparator key={`sep-${i}`} />
        ) : (
          <PopoverItem
            key={item.label}
            icon={item.icon}
            label={item.label}
            danger={item.danger}
            onSelect={() => {
              onClose();
              item.onSelect();
            }}
          />
        ),
      )}
    </div>,
    document.body,
  );
}
