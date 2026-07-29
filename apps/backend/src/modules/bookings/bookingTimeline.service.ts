import { prisma } from "../../config/prisma.js";
import { NotFoundError } from "../../common/errors.js";

/**
 * Booking Timeline（standalone feature，2026-07）：纯粹从既有栏位「读」出一条时间轴，
 * 不新增任何 Table、不碰 Dispatch/DriverJobs 既有的状态机写入逻辑——Leg 的
 * acceptedAt/driverArrivingAt/passengerOnBoardAt/completedAt 本来就是每次状态转换时
 * 就写好的时间戳（driverJobs.service.ts），DispatchOffer 的 offeredAt 本来就是 Send
 * Offer 当下写好的（dispatchOffer.service.ts）。这里只是把这些既有资料组合、排序成
 * 使用者要的六个事件类型。
 */

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

const EVENT_LABELS: Record<TimelineEventType, string> = {
  BOOKING_CREATED: "Booking Created",
  OFFER_SENT: "Offer Sent",
  DRIVER_ACCEPTED: "Driver Accepted",
  DRIVER_ARRIVED: "Driver Arrived",
  PASSENGER_ON_BOARD: "Passenger On Board",
  COMPLETED: "Completed"
};

export async function getBookingTimeline(bookingId: number) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      legs: {
        include: {
          driver: { select: { id: true, name: true } },
          dispatchOffers: { select: { offeredAt: true }, orderBy: { offeredAt: "asc" } }
        },
        orderBy: { sequence: "asc" }
      }
    }
  });

  if (!booking) {
    throw new NotFoundError(`Booking ${bookingId} not found`);
  }

  const events: TimelineEvent[] = [
    {
      type: "BOOKING_CREATED",
      label: EVENT_LABELS.BOOKING_CREATED,
      timestamp: booking.createdAt.toISOString(),
      driver: null,
      legId: null,
      legSequence: null,
      legType: null
    }
  ];

  for (const leg of booking.legs) {
    const legMeta = { legId: leg.id, legSequence: leg.sequence, legType: leg.legType };
    const driver = leg.driver ? { id: leg.driver.id, name: leg.driver.name } : null;

    // 一次 Send Offer 会同时给每个合格 Driver 各建一笔 DispatchOffer，offeredAt 几乎
    // 相同（同一个 Transaction 里建立）——同一个时间戳只算一次「Offer Sent」事件，
    // 不然同一批会在 Timeline 上重复出现好几笔内容几乎一样的纪录。
    const seenOfferedAt = new Set<string>();
    for (const offer of leg.dispatchOffers) {
      const key = offer.offeredAt.toISOString();
      if (seenOfferedAt.has(key)) continue;
      seenOfferedAt.add(key);
      events.push({ type: "OFFER_SENT", label: EVENT_LABELS.OFFER_SENT, timestamp: key, driver: null, ...legMeta });
    }

    if (leg.acceptedAt) {
      events.push({
        type: "DRIVER_ACCEPTED",
        label: EVENT_LABELS.DRIVER_ACCEPTED,
        timestamp: leg.acceptedAt.toISOString(),
        driver,
        ...legMeta
      });
    }

    if (leg.driverArrivingAt) {
      events.push({
        type: "DRIVER_ARRIVED",
        label: EVENT_LABELS.DRIVER_ARRIVED,
        timestamp: leg.driverArrivingAt.toISOString(),
        driver,
        ...legMeta
      });
    }

    if (leg.passengerOnBoardAt) {
      events.push({
        type: "PASSENGER_ON_BOARD",
        label: EVENT_LABELS.PASSENGER_ON_BOARD,
        timestamp: leg.passengerOnBoardAt.toISOString(),
        driver,
        ...legMeta
      });
    }

    if (leg.completedAt) {
      events.push({
        type: "COMPLETED",
        label: EVENT_LABELS.COMPLETED,
        timestamp: leg.completedAt.toISOString(),
        driver,
        ...legMeta
      });
    }
  }

  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return { bookingId: booking.id, girlName: booking.girlName, events };
}
