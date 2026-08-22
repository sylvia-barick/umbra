"use client";

import { useState } from "react";
import { useWallet } from "@/app/providers";
import { optionsFactoryClient } from "@/lib/contracts";
import { parseFixed } from "@/lib/format";
import { underlyingAsset } from "@/hooks/useUmbraData";
import { useTx } from "@/hooks/useTx";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

interface CreateSeriesModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  tokenDecimals: number;
  underlyingSymbol: string;
}

export function CreateSeriesModal({ open, onClose, onSuccess, tokenDecimals, underlyingSymbol }: CreateSeriesModalProps) {
  const wallet = useWallet();
  const { run, busy } = useTx();
  const [strike, setStrike] = useState("");
  const [expiry, setExpiry] = useState("");

  async function submit() {
    if (!wallet.address || !strike || !expiry) return;
    const strikeRaw = parseFixed(strike, tokenDecimals);
    const expirySecs = BigInt(Math.floor(new Date(expiry).getTime() / 1000));
    await run(
      async () => {
        const client = await optionsFactoryClient(wallet.address, wallet.signTransaction);
        return (
          await client.create_series({ underlying: underlyingAsset(), strike: strikeRaw, expiry: expirySecs })
        ).signAndSend();
      },
      { pendingTitle: "Creating series…", successTitle: `Created ${underlyingSymbol} $${strike} series` },
    );
    setStrike("");
    setExpiry("");
    onSuccess();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Create option series">
      <div className="space-y-4">
        <p className="text-xs text-umbra-muted">
          Series creation is permissionless once the expiry sits on the admin-approved grid — an unapproved expiry
          will simply be rejected on-chain.
        </p>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-umbra-muted">Strike price (USDC)</label>
          <Input type="number" min="0" step="0.01" placeholder="e.g. 0.12" value={strike} onChange={(e) => setStrike(e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-umbra-muted">Expiry</label>
          <Input type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </div>
        {!wallet.connected ? (
          <Button className="w-full" onClick={wallet.connect} loading={wallet.connecting}>
            Connect wallet
          </Button>
        ) : (
          <Button className="w-full" onClick={submit} loading={busy} disabled={!strike || !expiry}>
            Create series
          </Button>
        )}
      </div>
    </Modal>
  );
}
