"use client";

import { useToasts } from "@/app/providers";

const iconFor = {
  pending: (
    <svg className="h-4 w-4 animate-spin text-umbra-violet-glow" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3.5" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v3.5A4.5 4.5 0 007.5 12H4z" />
    </svg>
  ),
  success: (
    <svg className="h-4 w-4 text-umbra-call" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a1 1 0 00-1.4-1.4L9 10.6 7.7 9.3a1 1 0 00-1.4 1.4l2 2a1 1 0 001.4 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  ),
  error: (
    <svg className="h-4 w-4 text-umbra-put" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-7a1 1 0 102 0V6a1 1 0 10-2 0v5zm1 4a1.25 1.25 0 100-2.5 1.25 1.25 0 000 2.5z"
        clipRule="evenodd"
      />
    </svg>
  ),
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2 sm:bottom-6 sm:right-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto animate-fade-up rounded-xl border border-umbra-border bg-umbra-panel-raised p-3.5 shadow-panel"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0">{iconFor[t.kind]}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-umbra-ink">{t.title}</p>
              {t.detail && <p className="mt-0.5 break-words text-xs text-umbra-muted">{t.detail}</p>}
              {t.href && (
                <a
                  href={t.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-xs text-umbra-violet-glow hover:underline"
                >
                  View on Stellar Expert ↗
                </a>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded p-0.5 text-umbra-faint hover:text-umbra-ink"
              aria-label="Dismiss"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.7 5.3a1 1 0 00-1.4 1.4L8.6 10l-3.3 3.3a1 1 0 101.4 1.4L10 11.4l3.3 3.3a1 1 0 001.4-1.4L11.4 10l3.3-3.3a1 1 0 00-1.4-1.4L10 8.6 6.7 5.3z" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
