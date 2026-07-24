import type { BookingStatus, LegStatus, LegType } from "../../types/booking";

export type LegWalletStatus = "PENDING" | "SETTLED" | "VOIDED";

export interface DriverLeg {
  id: number;
  bookingId: number;
  sequence: number;
  legType: LegType;
  driverId: number | null;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  scheduledAt: string | null;
  notes: string | null;
  status: LegStatus;
  rejectionReason: string | null;
  assignedAt: string | null;
  acceptedAt: string | null;
  driverArrivingAt: string | null;
  passengerOnBoardAt: string | null;
  completedAt: string | null;
  rejectedAt: string | null;
  // 该 Leg 实际分配给本人 Driver 的收入（不是 Booking 总车费，也不是其他 Driver 的分润）。
  // 只有实际产生过 WalletTransaction 才会有值（通常是 Completed 之后）。
  driverEarningCents: number | null;
  walletStatus: LegWalletStatus | null;
  settlementReference: string | null;
  booking: {
    id: number;
    girlName: string;
    // 顾客支付的总车费（整张 Booking，可能包含多个 Leg 共用同一笔车费）。
    totalAmountCents: number;
    notes: string | null;
    status: BookingStatus;
  };
}
