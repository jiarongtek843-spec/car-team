export type CollectionPaymentMethod = "CASH" | "TRANSFER_TO_DRIVER" | "TRANSFER_TO_COMPANY" | "TNG" | "OTHER";
export type CollectionPurpose =
  | "ITEM_PURCHASE"
  | "DELIVERY_FEE"
  | "PARCEL"
  | "EXTRA_CHARGE"
  | "PARKING"
  | "TOLL"
  | "OTHER";
export type CollectionStatus = "PENDING" | "COLLECTED" | "VERIFIED" | "SETTLED" | "VOIDED";

export interface Collection {
  id: number;
  bookingId: number;
  booking: { id: number; girlName: string } | null;
  legId: number | null;
  leg: { id: number; sequence: number } | null;
  driverId: number;
  driver: { id: number; name: string } | null;
  customerName: string | null;
  purpose: CollectionPurpose;
  amountCents: number;
  paymentMethod: CollectionPaymentMethod;
  status: CollectionStatus;
  collectedAt: string | null;
  remark: string | null;
  proofImageUrl: string | null;
  createdAt: string;
  createdByUser: { id: number; username: string } | null;
  verifiedAt: string | null;
  verifiedByUser: { id: number; username: string } | null;
  voidedAt: string | null;
  voidedByUser: { id: number; username: string } | null;
  voidReason: string | null;
  settledAt: string | null;
  settlement: { id: number; reference: string } | null;
}

export const PAYMENT_METHOD_LABELS: Record<CollectionPaymentMethod, string> = {
  CASH: "Cash",
  TRANSFER_TO_DRIVER: "Transfer To Driver",
  TRANSFER_TO_COMPANY: "Transfer To Company",
  TNG: "TNG",
  OTHER: "Other"
};

export const PURPOSE_LABELS: Record<CollectionPurpose, string> = {
  ITEM_PURCHASE: "Item Purchase",
  DELIVERY_FEE: "Delivery Fee",
  PARCEL: "Parcel",
  EXTRA_CHARGE: "Extra Charge",
  PARKING: "Parking",
  TOLL: "Toll",
  OTHER: "Other"
};

export const STATUS_LABELS: Record<CollectionStatus, string> = {
  PENDING: "Pending",
  COLLECTED: "Collected",
  VERIFIED: "Verified",
  SETTLED: "Settled",
  VOIDED: "Voided"
};
