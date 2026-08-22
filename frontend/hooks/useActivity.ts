"use client";

import { useEffect, useState } from "react";
import { ActivityItem, fetchRecentActivity } from "@/lib/activity";

const POLL_MS = 30_000;

export function useActivity(tokenDecimals: number, priceDecimals: number, refreshKey: number) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const next = await fetchRecentActivity(tokenDecimals, priceDecimals);
        if (!cancelled) setItems(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tokenDecimals, priceDecimals, refreshKey]);

  return { items, loading };
}
