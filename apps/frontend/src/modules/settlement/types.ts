import type { WalletTransaction } from "../wallet/types";

export type SettlementStatus = "DRAFT" | "COMPLETED" | "VOIDED";

export interface SettlementPreview {
  driver: { id: number; name: string };
  periodStart: string;
  periodEnd: string;
  transactions: WalletTransaction[];
  excludedTransactions: WalletTransaction[];
  completedLegEarningsCents: number;
  positiveAdjustmentsCents: number;
  negativeAdjustmentsCents: number;
  netAmountCents: number;
}

export interface SettlementItem {
  id: number;
  amountCents: number;
  walletTransaction: WalletTransaction;
}

export interface Settlement {
  id: number;
  reference: string;
  driverId: number;
  driver: { id: number; name: string };
  periodStart: string;
  periodEnd: string;
  status: SettlementStatus;
  netAmountCents: number;
  createdAt: string;
  createdByUser: { id: number; username: string } | null;
  voidedAt: string | null;
  voidedByUser: { id: number; username: string } | null;
  voidReason: string | null;
  items?: SettlementItem[];
  reversalTransactions?: WalletTransaction[];
}
