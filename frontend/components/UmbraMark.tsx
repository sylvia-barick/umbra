export function UmbraMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="umbra-mark-grad" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#a596ff" />
          <stop offset="100%" stopColor="#5c4fd6" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#umbra-mark-grad)" opacity="0.16" />
      <path
        d="M20.5 8.5a9.5 9.5 0 100 15c-6-1.2-8-5.5-8-7.5s2-6.3 8-7.5z"
        fill="url(#umbra-mark-grad)"
      />
    </svg>
  );
}
