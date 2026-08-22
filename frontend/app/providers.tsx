"use client";

import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { useFreighter } from "@/hooks/useFreighter";
import { config } from "@/lib/stellar";
import type { SignTransaction } from "@/lib/contracts";

interface WalletContextValue {
  ready: boolean;
  installed: boolean;
  connected: boolean;
  address: string | null;
  network: string | null;
  connecting: boolean;
  error: string | null;
  wrongNetwork: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: SignTransaction;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within <Providers>");
  return ctx;
}

interface Toast {
  id: number;
  kind: "pending" | "success" | "error";
  title: string;
  detail?: string;
  href?: string;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => number;
  update: (id: number, patch: Partial<Toast>) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToasts() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts must be used within <Providers>");
  return ctx;
}

let toastSeq = 1;

export function Providers({ children }: { children: ReactNode }) {
  const freighter = useFreighter();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = toastSeq++;
    setToasts((prev) => [...prev, { ...toast, id }]);
    if (toast.kind !== "pending") {
      window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
    }
    return id;
  }, []);

  const update = useCallback((id: number, patch: Partial<Toast>) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    if (patch.kind && patch.kind !== "pending") {
      window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
    }
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toastValue = useMemo(() => ({ toasts, push, update, dismiss }), [toasts, push, update, dismiss]);

  const wrongNetwork = useMemo(() => {
    if (!freighter.network) return false;
    const wantsTestnet = config.networkPassphrase.includes("Test");
    const isTestnet = freighter.network.toUpperCase().includes("TEST");
    return wantsTestnet !== isTestnet;
  }, [freighter.network]);

  const signTransaction: SignTransaction = useCallback(
    async (xdr: string, opts?: { networkPassphrase?: string; address?: string }) => {
      const signedTxXdr = await freighter.sign(xdr, opts?.networkPassphrase ?? config.networkPassphrase);
      return { signedTxXdr, signerAddress: freighter.address ?? undefined };
    },
    [freighter],
  );

  const walletValue = useMemo<WalletContextValue>(
    () => ({
      ready: freighter.ready,
      installed: freighter.installed,
      connected: freighter.connected,
      address: freighter.address,
      network: freighter.network,
      connecting: freighter.connecting,
      error: freighter.error,
      wrongNetwork,
      connect: freighter.connect,
      disconnect: freighter.disconnect,
      signTransaction,
    }),
    [freighter, wrongNetwork, signTransaction],
  );

  return (
    <WalletContext.Provider value={walletValue}>
      <ToastContext.Provider value={toastValue}>{children}</ToastContext.Provider>
    </WalletContext.Provider>
  );
}
