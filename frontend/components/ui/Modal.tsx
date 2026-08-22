"use client";

import { ReactNode, useEffect } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md animate-fade-up rounded-t-2xl border border-umbra-border bg-umbra-panel shadow-panel sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-umbra-border-soft px-5 py-4">
          <h3 className="text-sm font-semibold text-umbra-ink">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-umbra-faint hover:text-umbra-ink" aria-label="Close">
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.7 5.3a1 1 0 00-1.4 1.4L8.6 10l-3.3 3.3a1 1 0 101.4 1.4L10 11.4l3.3 3.3a1 1 0 001.4-1.4L11.4 10l3.3-3.3a1 1 0 00-1.4-1.4L10 8.6 6.7 5.3z" />
            </svg>
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
