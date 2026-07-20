export type BookingStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
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
  driverId: number | null;
  driver: Driver | null;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  scheduledAt: string | null;
  notes: string | null;
  status: LegStatus;
  earningAllocationCents: number | null;
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
  pickupLocation?: string;
  dropoffLocation?: string;
  scheduledAt?: string;
  driverId?: number;
  notes?: string;
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
  pickupLocation?: string;
  dropoffLocation?: string;
  scheduledAt?: string;
  notes?: string;
  earningAllocationCents?: number;
}
