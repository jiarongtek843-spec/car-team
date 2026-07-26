export type BookingStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type LegType = "OUTBOUND" | "RETURN" | "ADDITIONAL";
export type LegStatus =
  | "PENDING"
  | "ASSIGNED"
  | "ACCEPTED"
  | "DRIVER_ARRIVING"
  | "PASSENGER_ON_BOARD"
  | "COMPLETED"
  | "REJECTED"
  | "CANCELLED";
export type DriverStatus = "ACTIVE" | "INACTIVE";
export type CommissionType = "PERCENTAGE" | "FIXED_AMOUNT";

export interface Driver {
  id: number;
  name: string;
  phone: string | null;
  vehiclePlateNumber?: string | null;
  remark?: string | null;
  status: DriverStatus;
  username?: string | null;
  hasActiveLeg?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Leg {
  id: number;
  bookingId: number;
  sequence: number;
  legType: LegType;
  driverId: number | null;
  driver: Driver | null;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  scheduledAt: string | null;
  estimatedDurationMinutes: number | null;
  estimatedFinishAt: string | null;
  notes: string | null;
  status: LegStatus;
  earningAllocationCents: number | null;
  earningAllocationManual: boolean;
  rejectionReason: string | null;
  assignedAt: string | null;
  acceptedAt: string | null;
  driverArrivingAt: string | null;
  passengerOnBoardAt: string | null;
  completedAt: string | null;
  rejectedAt: string | null;
}

export interface Booking {
  id: number;
  girlName: string;
  notes: string | null;
  totalAmountCents: number;
  platformCommissionType: CommissionType;
  platformCommissionValue: number;
  platformAmountCents: number;
  driverPoolAmountCents: number;
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
  legs: Leg[];
}

export interface BookingListItem extends Omit<Booking, "legs"> {
  legs: { status: LegStatus }[];
}

export interface PagedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateLegInput {
  legType?: LegType;
  pickupLocation?: string;
  dropoffLocation?: string;
  // undefined = 没带这个栏位；null = 明确选择「时间未定」；string = 实际时间。
  scheduledAt?: string | null;
  estimatedDurationMinutes?: number | null;
  estimatedFinishAt?: string | null;
  driverId?: number;
  notes?: string;
  // 正常流程不用带这个——Driver Income 现在预设自动平分 Driver Pool。带了才代表
  // 明确要 override 这笔的金额。
  earningAllocationCents?: number;
}

export interface CreateBookingInput {
  girlName: string;
  notes?: string;
  totalAmountCents?: number;
  commissionType?: CommissionType;
  commissionValue?: number;
  legs?: CreateLegInput[];
}

export interface UpdateBookingInput {
  girlName?: string;
  notes?: string;
  totalAmountCents?: number;
  commissionType?: CommissionType;
  commissionValue?: number;
}

export interface UpdateLegInput {
  legType?: LegType;
  pickupLocation?: string;
  dropoffLocation?: string;
  scheduledAt?: string | null;
  estimatedDurationMinutes?: number | null;
  estimatedFinishAt?: string | null;
  notes?: string;
  earningAllocationCents?: number;
}
