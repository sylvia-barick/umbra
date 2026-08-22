/** Maps Umbra's underlying symbol to a TradingView ticker for the chart widget. */
const SYMBOL_MAP: Record<string, string> = {
  XLM: "BINANCE:XLMUSDT",
  BTC: "BINANCE:BTCUSDT",
  ETH: "BINANCE:ETHUSDT",
  USDC: "BINANCE:USDCUSDT",
};

export function tradingViewSymbol(underlyingSymbol: string): string {
  return SYMBOL_MAP[underlyingSymbol.toUpperCase()] ?? `BINANCE:${underlyingSymbol.toUpperCase()}USDT`;
}
