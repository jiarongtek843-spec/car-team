export type TimelineEventType =
  | "BOOKING_CREATED"
  | "OFFER_SENT"
  | "DRIVER_ACCEPTED"
  | "DRIVER_ARRIVED"
  | "PASSENGER_ON_BOARD"
  | "COMPLETED";

export interface TimelineEvent {
  type: TimelineEventType;
  label: string;
  timestamp: string;
  driver: { id: number; name: string } | null;
  legId: number | null;
  legSequence: number | null;
  legType: string | null;
}

export interface BookingTimeline {
  bookingId: number;
  girlName: string;
  events: TimelineEvent[];
}
