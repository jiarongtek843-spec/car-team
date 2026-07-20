import type { WalletTransaction } from "../wallet/types";
import type { Collection } from "../collections/types";

export type SettlementStatus = "DRAFT" | "COMPLETED" | "VOIDED";

export interface SettlementPreview {
  driver: { id: number; name: string };
  periodStart: string;
  periodEnd: string;
  transactions: WalletTransaction[];
  excludedTransactions: WalletTransaction[];
  collections: Collection[];
  excludedCollections: Collection[];
  completedLegEarningsCents: number;
  positiveAdjustmentsCents: number;
  negativeAdjustmentsCents: number;
  walletAmountCents: number;
  collectionAmountCents: number;
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
  walletAmountCents: number;
  collectionAmountCents: number;
  netAmountCents: number;
  createdAt: string;
  createdByUser: { id: number; username: string } | null;
  voidedAt: string | null;
  voidedByUser: { id: number; username: string } | null;
  voidReason: string | null;
  items?: SettlementItem[];
  reversalTransactions?: WalletTransaction[];
  collections?: Collection[];
}
