import { ReactNode } from "react";

type Tone = "neutral" | "call" | "put" | "warn" | "violet" | "success" | "danger";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-white/5 text-umbra-muted border-umbra-border",
  call: "bg-umbra-call/10 text-umbra-call border-umbra-call/25",
  put: "bg-umbra-put/10 text-umbra-put border-umbra-put/25",
  warn: "bg-umbra-warn/10 text-umbra-warn border-umbra-warn/25",
  violet: "bg-umbra-violet/10 text-umbra-violet-glow border-umbra-violet/30",
  success: "bg-umbra-call/10 text-umbra-call border-umbra-call/25",
  danger: "bg-umbra-put/10 text-umbra-put border-umbra-put/25",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}
