"use client";

import { useEffect, useRef } from "react";

interface TradingViewChartProps {
  symbol: string;
  height?: number;
}

/**
 * Embeds TradingView's free "Advanced Chart" widget for real market context
 * on the underlying — genuine OHLC history, drawing tools, and timeframes
 * that a synthetic on-chain oracle-tick chart can't match. This is reference
 * context only: actual quotes/settlement still come from Reflector via
 * oracle-adapter, untouched by whatever this widget renders.
 *
 * Unstyled/flush by design (no border, radius, or shadow of its own) — it's
 * meant to sit inside a bordered terminal grid (see MarketView) the way a
 * perp DEX's chart pane does, not float as an independent card.
 */
export function TradingViewChart({ symbol, height = 460 }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.height = "calc(100% - 32px)";
    widgetDiv.style.width = "100%";
    container.appendChild(widgetDiv);

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.text = JSON.stringify({
      allow_symbol_change: false,
      calendar: false,
      details: false,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_volume: false,
      hotlist: false,
      interval: "60",
      locale: "en",
      save_image: false,
      style: "1",
      symbol,
      theme: "dark",
      timezone: "Etc/UTC",
      backgroundColor: "#0f1116",
      gridColor: "rgba(255, 255, 255, 0.06)",
      watchlist: [],
      withdateranges: true,
      compareSymbols: [],
      support_host: "https://www.tradingview.com",
      studies: [],
      autosize: true,
    });
    container.appendChild(script);
  }, [symbol]);

  return (
    // TradingView's init script resets its container's own height style to
    // 100% once it mounts (overwriting whatever we set there), so the fixed
    // height has to live on this outer wrapper for the widget to have
    // something non-zero to resolve 100% against.
    <div className="overflow-hidden bg-umbra-panel" style={{ height }}>
      <div ref={containerRef} className="tradingview-widget-container h-full w-full" />
    </div>
  );
}
