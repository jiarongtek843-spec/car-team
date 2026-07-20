export type BookingStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type LegStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type DriverStatus = "ACTIVE" | "INACTIVE";

export interface Driver {
  id: number;
  name: string;
  phone: string | null;
  status: DriverStatus;
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
