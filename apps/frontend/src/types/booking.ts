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
  carFee: number | null;
  notes: string | null;
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
}

export interface CreateBookingInput {
  girlName: string;
  carFee?: number;
  notes?: string;
  legs?: CreateLegInput[];
}

export interface UpdateBookingInput {
  girlName?: string;
  carFee?: number;
  notes?: string;
}

export interface UpdateLegInput {
  pickupLocation?: string;
  dropoffLocation?: string;
  scheduledAt?: string;
  notes?: string;
}
