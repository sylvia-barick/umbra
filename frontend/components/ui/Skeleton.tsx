export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-shimmer rounded-md bg-[linear-gradient(110deg,#151822,45%,#1d2130,55%,#151822)] bg-[length:200%_100%] ${className}`}
    />
  );
}
