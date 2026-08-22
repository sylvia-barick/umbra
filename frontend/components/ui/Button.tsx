"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "call" | "put";
type Size = "sm" | "md" | "lg";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-umbra-violet text-white shadow-glow hover:bg-umbra-violet-glow disabled:bg-umbra-violet/40 disabled:shadow-none",
  secondary:
    "bg-umbra-panel-raised text-umbra-ink border border-umbra-border hover:border-umbra-violet/50 hover:bg-white/[0.04] disabled:opacity-40",
  ghost: "bg-transparent text-umbra-muted hover:text-umbra-ink hover:bg-white/[0.04] disabled:opacity-40",
  danger: "bg-umbra-put/90 text-white hover:bg-umbra-put disabled:opacity-40",
  call: "bg-umbra-call/90 text-black hover:bg-umbra-call disabled:opacity-40",
  put: "bg-umbra-put/90 text-white hover:bg-umbra-put disabled:opacity-40",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className = "", children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-umbra-violet/50 disabled:cursor-not-allowed active:scale-[0.98] ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {loading && (
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3.5" />
          <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v3.5A4.5 4.5 0 007.5 12H4z" />
        </svg>
      )}
      {children}
    </button>
  );
});
