import { InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  suffix?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = "", suffix, ...props },
  ref,
) {
  return (
    <div className="relative">
      <input
        ref={ref}
        className={`w-full rounded-lg border border-umbra-border bg-umbra-panel-raised px-3 py-2.5 text-sm text-umbra-ink tabular placeholder:text-umbra-faint focus:border-umbra-violet/60 focus:outline-none focus:ring-2 focus:ring-umbra-violet/20 ${suffix ? "pr-14" : ""} ${className}`}
        {...props}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-umbra-faint">
          {suffix}
        </span>
      )}
    </div>
  );
});
