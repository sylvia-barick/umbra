"use client";

import Script from "next/script";

const SYMBOLS = "BINANCE:XLMUSDT,BITSTAMP:BTCUSD,BITSTAMP:ETHUSD,FX:EURUSD,CMCMARKETS:GOLD";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "tv-ticker-tape": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        symbols?: string;
      };
    }
  }
}

export function TickerTape() {
  return (
    <div className="border-b border-umbra-border-soft bg-umbra-bg/60">
      <Script src="https://widgets.tradingview-widget.com/w/en/tv-ticker-tape.js" type="module" strategy="afterInteractive" />
      {/* eslint-disable-next-line react/no-unknown-property */}
      <tv-ticker-tape symbols={SYMBOLS} />
    </div>
  );
}
