import type { BookingStatus, LegStatus, LegType } from "../../types/booking";

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
  booking: {
    id: number;
    girlName: string;
    carFee: number | null;
    notes: string | null;
    status: BookingStatus;
  };
}
