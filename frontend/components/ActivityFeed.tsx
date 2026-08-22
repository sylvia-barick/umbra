"use client";

import { ActivityItem } from "@/lib/activity";
import { Skeleton } from "@/components/ui/Skeleton";

interface ActivityFeedProps {
  items: ActivityItem[];
  loading: boolean;
}

const toneDot: Record<ActivityItem["tone"], string> = {
  call: "bg-umbra-call",
  put: "bg-umbra-put",
  violet: "bg-umbra-violet",
  neutral: "bg-umbra-faint",
};

export function ActivityFeed({ items, loading }: ActivityFeedProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-umbra-border px-4 py-2 text-sm font-semibold text-umbra-ink">Activity</div>
      <div className="min-h-0 flex-1 divide-y divide-umbra-border-soft overflow-y-auto">
        {loading && items.length === 0 ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-4 py-2">
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-umbra-faint">
            No activity in the last day yet.
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="flex items-center gap-2 px-4 py-1.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[item.tone]}`} />
              <span className="w-20 shrink-0 text-xs font-medium text-umbra-ink">{item.label}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] tabular text-umbra-muted">{item.detail}</span>
              <span className="shrink-0 text-[10px] text-umbra-faint">{timeAgo(item.time)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function timeAgo(unixSecs: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSecs);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
