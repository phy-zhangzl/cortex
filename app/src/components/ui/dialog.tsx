import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll("[role=dialog]");
      if (dialogs[dialogs.length - 1] !== panel.current) return; // only the topmost dialog reacts
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-6 backdrop-blur-[2px] animate-in fade-in-0 duration-150 dark:bg-black/50"
      onMouseDown={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        className={cn(
          "no-drag flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-background shadow-pop animate-in fade-in-0 zoom-in-95 duration-150",
          className,
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-6 pb-1 pt-5">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {children ? <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div> : <div className="h-4" />}
        {footer && <div className="flex items-center justify-end gap-2 bg-muted/50 px-6 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-foreground/80">{label}</span>
      {children}
      {hint && <span className="block text-[11.5px] leading-relaxed text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "no-drag h-9 w-full rounded-lg border border-input bg-background px-3 text-[13px] shadow-sm outline-none transition-shadow placeholder:text-muted-foreground/70 focus:border-ring/60 focus:ring-[3px] focus:ring-ring/15";

/** Grouped settings card (macOS System Settings style). */
export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      {title && <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>}
      <div className="divide-y divide-border rounded-xl border border-border bg-card">{children}</div>
    </section>
  );
}

export function SettingsRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{hint}</div>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}
