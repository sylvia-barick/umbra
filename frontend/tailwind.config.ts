import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        umbra: {
          bg: "#08090c",
          panel: "#0f1116",
          "panel-raised": "#151822",
          border: "#22262f",
          "border-soft": "#1a1d25",
          ink: "#e9eaef",
          muted: "#8b8fa0",
          faint: "#5c6070",
          // Named "violet" for historical reasons, now carrying the
          // signature bright green pulled from design.md's extracted
          // palette (a Hyperliquid-style trading-terminal accent) — kept
          // the token name to avoid a mass rename across every component.
          violet: {
            DEFAULT: "#18d26e",
            soft: "#123524",
            glow: "#79efbd",
          },
          call: "#18d26e",
          put: "#ff5c72",
          warn: "#f2b84b",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(24,210,110,0.18), 0 8px 30px -8px rgba(24,210,110,0.35)",
        panel: "0 1px 0 0 rgba(255,255,255,0.02) inset, 0 12px 40px -20px rgba(0,0,0,0.6)",
      },
      backgroundImage: {
        "umbra-radial":
          "radial-gradient(80% 60% at 50% -10%, rgba(24,210,110,0.14) 0%, rgba(24,210,110,0) 60%)",
        "umbra-grid":
          "linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s ease-out both",
        shimmer: "shimmer 2.2s linear infinite",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
