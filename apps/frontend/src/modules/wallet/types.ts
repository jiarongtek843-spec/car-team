export type WalletTransactionType =
  | "LEG_EARNING"
  | "MANUAL_ADJUSTMENT"
  | "SETTLEMENT_ADJUSTMENT"
  | "EXPENSE_REIMBURSEMENT"
  | "REVENUE_SHARE_PAYOUT";
export type WalletTransactionStatus = "PENDING" | "SETTLED" | "VOIDED";

export interface WalletTransaction {
  id: number;
  driverId: number;
  driver: { id: number; name: string } | null;
  bookingId: number | null;
  booking: { id: number; girlName: string } | null;
  legId: number | null;
  leg: { id: number; sequence: number } | null;
  transactionType: WalletTransactionType;
  amountCents: number;
  description: string | null;
  status: WalletTransactionStatus;
  effectiveDate: string;
  createdAt: string;
  settledAt: string | null;
  settlement: { id: number; reference: string } | null;
  relatedSettlementId: number | null;
  relatedSettlement: { id: number; reference: string } | null;
}

export interface DriverWalletSummary {
  todayPendingCents: number;
  unsettledCents: number;
  settledCents: number;
}

export interface UnsettledByDriverItem {
  driverId: number;
  driver: { id: number; name: string } | null;
  unsettledCents: number;
}
