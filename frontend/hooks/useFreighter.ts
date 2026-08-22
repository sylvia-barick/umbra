"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAddress,
  getNetwork,
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";

export interface FreighterState {
  ready: boolean;
  installed: boolean;
  connected: boolean;
  address: string | null;
  network: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  sign: (xdr: string, networkPassphrase: string) => Promise<string>;
}

export function useFreighter(): FreighterState {
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkConnection = useCallback(async () => {
    try {
      const { isConnected: hasExtension, error: connErr } = await isConnected();
      if (connErr || !hasExtension) {
        setInstalled(false);
        setReady(true);
        return;
      }
      setInstalled(true);
      const { address: addr, error: addrErr } = await getAddress();
      if (addrErr || !addr) {
        setReady(true);
        return;
      }
      const { network: net } = await getNetwork();
      setConnected(true);
      setAddress(addr);
      setNetwork(net ?? null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const { isConnected: hasExtension } = await isConnected();
      if (!hasExtension) {
        throw new Error("Freighter isn't installed. Get it at freighter.app.");
      }
      const { address: addr, error: accessErr } = await requestAccess();
      if (accessErr) throw new Error(accessErr.message);
      const { network: net, error: netErr } = await getNetwork();
      if (netErr) throw new Error(netErr.message);
      setConnected(true);
      setAddress(addr);
      setNetwork(net ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setConnected(false);
    setAddress(null);
    setNetwork(null);
  }, []);

  const sign = useCallback(async (xdr: string, networkPassphrase: string) => {
    const { signedTxXdr, error: signErr } = await signTransaction(xdr, { networkPassphrase });
    if (signErr) throw new Error(signErr.message);
    return signedTxXdr;
  }, []);

  return { ready, installed, connected, address, network, connecting, error, connect, disconnect, sign };
}
