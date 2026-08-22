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
          violet: {
            DEFAULT: "#8b7bff",
            soft: "#443b7a",
            glow: "#a596ff",
          },
          call: "#3ddc97",
          put: "#ff6b81",
          warn: "#f2b84b",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(139,123,255,0.15), 0 8px 30px -8px rgba(139,123,255,0.35)",
        panel: "0 1px 0 0 rgba(255,255,255,0.02) inset, 0 12px 40px -20px rgba(0,0,0,0.6)",
      },
      backgroundImage: {
        "umbra-radial":
          "radial-gradient(80% 60% at 50% -10%, rgba(139,123,255,0.16) 0%, rgba(139,123,255,0) 60%)",
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
