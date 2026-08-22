/**
 * Normalizes a contract-client-decoded numeric field to bigint. Some SDK
 * decode paths return i128/u64 values as JS `number` when they're small
 * enough to round-trip safely rather than always returning `bigint` —
 * call this at the boundary where contract results enter app state so
 * every hook/component downstream can do plain bigint arithmetic without
 * re-checking the runtime type every time.
 */
export function toBig(value: bigint | number): bigint {
  return typeof value === "bigint" ? value : BigInt(Math.trunc(value));
}

/**
 * Renders a fixed-point i128 at `decimals` scale into a human string.
 * Accepts number too: some contract-client decode paths return i128/u64
 * fields as JS `number` rather than `bigint` when the value is small
 * enough to round-trip safely, so this normalizes either input.
 */
export function formatFixed(value: bigint | number, decimals: number, maxFrac = 4): string {
  const big = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
  const negative = big < 0n;
  const abs = negative ? -big : big;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = abs % scale;
  let fracStr = frac.toString().padStart(decimals, "0").slice(0, maxFrac);
  fracStr = fracStr.replace(/0+$/, "");
  const wholeStr = whole.toLocaleString("en-US");
  const sign = negative ? "-" : "";
  return fracStr ? `${sign}${wholeStr}.${fracStr}` : `${sign}${wholeStr}`;
}

/** Parses a human decimal string into a fixed-point i128 (as bigint) at `decimals` scale. */
export function parseFixed(input: string, decimals: number): bigint {
  const trimmed = input.trim();
  if (!trimmed) return 0n;
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [wholePart, fracPart = ""] = unsigned.split(".");
  const paddedFrac = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  const digits = `${wholePart || "0"}${paddedFrac}`.replace(/^0+(?=\d)/, "");
  const value = BigInt(digits || "0");
  return negative ? -value : value;
}

export function formatCountdown(expirySecs: bigint | number): string {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const expiry = typeof expirySecs === "bigint" ? expirySecs : BigInt(Math.trunc(expirySecs));
  const diff = expiry - now;
  if (diff <= 0n) return "expired";
  const d = diff / 86400n;
  const h = (diff % 86400n) / 3600n;
  const m = (diff % 3600n) / 60n;
  if (d > 0n) return `${d}d ${h}h`;
  if (h > 0n) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatDate(secs: bigint | number): string {
  return new Date(Number(secs) * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortAddr(addr: string, lead = 4, tail = 4): string {
  if (addr.length <= lead + tail + 3) return addr;
  return `${addr.slice(0, lead)}…${addr.slice(-tail)}`;
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}
