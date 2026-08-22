"use client";

import { SeriesRow } from "@/hooks/useUmbraData";
import { formatFixed } from "@/lib/format";
import { Modal } from "@/components/ui/Modal";
import { OrderForm } from "@/components/OrderForm";

interface TradeDrawerProps {
  row: SeriesRow | null;
  initialSide: "call" | "put";
  onClose: () => void;
  onSuccess: () => void;
  tokenSymbol: string;
  tokenDecimals: number;
  priceDecimals: number;
  underlyingSymbol: string;
}

/** Modal wrapper around OrderForm — used for quick actions outside the main
 * Markets trading view (e.g. "Manage" on an open position). The Markets tab
 * itself docks OrderForm inline instead of popping this. */
export function TradeDrawer({ row, initialSide, onClose, onSuccess, ...formProps }: TradeDrawerProps) {
  if (!row) return null;

  return (
    <Modal
      open={!!row}
      onClose={onClose}
      title={`${formProps.underlyingSymbol} $${formatFixed(row.info.strike, formProps.tokenDecimals, 2)} · Series #${row.id}`}
    >
      <OrderForm
        row={row}
        initialSide={initialSide}
        onSuccess={() => {
          onSuccess();
          onClose();
        }}
        {...formProps}
      />
    </Modal>
  );
}
