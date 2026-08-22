"use client";

import { useState } from "react";
import { useWallet } from "@/app/providers";
import { shortAddr } from "@/lib/format";
import { Button } from "@/components/ui/Button";

export function ConnectButton() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);

  if (!wallet.ready) {
    return <div className="h-10 w-32 animate-pulse rounded-lg bg-umbra-panel-raised" />;
  }

  if (wallet.connected && wallet.address) {
    return (
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-lg border border-umbra-border bg-umbra-panel-raised px-3 py-2 text-sm transition-colors hover:border-umbra-violet/50"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${wallet.wrongNetwork ? "bg-umbra-warn" : "bg-umbra-call"}`} />
          <span className="font-mono tabular">{shortAddr(wallet.address)}</span>
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-umbra-border bg-umbra-panel-raised p-2 shadow-panel">
              {wallet.wrongNetwork && (
                <div className="mb-2 rounded-md bg-umbra-warn/10 px-3 py-2 text-xs text-umbra-warn">
                  Freighter is on the wrong network — switch to Testnet.
                </div>
              )}
              <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-umbra-faint">Connected</div>
              <div className="break-all px-3 pb-2 font-mono text-xs text-umbra-muted">{wallet.address}</div>
              <button
                onClick={() => {
                  wallet.disconnect();
                  setOpen(false);
                }}
                className="w-full rounded-md px-3 py-2 text-left text-sm text-umbra-put transition-colors hover:bg-umbra-put/10"
              >
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={wallet.connect} loading={wallet.connecting} size="md">
        {wallet.connecting ? "Connecting…" : "Connect Freighter"}
      </Button>
      {wallet.error && <span className="max-w-[220px] text-right text-xs text-umbra-put">{wallet.error}</span>}
    </div>
  );
}
