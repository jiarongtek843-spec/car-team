import type { DriverLocationEntry } from "../gps/types";
import type { DriverPresenceEntry, DriverPresenceState } from "../driverPresence/types";
import type { DispatchWaitingLeg } from "../dispatch/types";

/**
 * Live Dispatch Map 纯粹重用既有三个模块的资料，不重新计算任何业务逻辑：
 * - 位置来自 GPS Foundation 的 /api/admin/gps/locations（只有目前仍在报点的 Driver）
 * - 状态/Current Booking 来自 Driver Presence 的 /api/admin/driver-presence（全部 ACTIVE Driver）
 * 用 driverId 在前端 join 这两份资料，只有「两边都有」的 Driver 才画得出 Marker——OFFLINE/
 * BREAK 的 Driver 本来就不会出现在 GPS Foundation 的 locations 清单里（GPS Foundation 明确
 * 只允许 AVAILABLE/PENDING_OFFER/ACCEPTED_JOB/ON_TRIP 上传定位），所以地图上天生不会画出
 * Offline Marker——这是既有设计的自然结果，不是这次刻意要漏掉。
 */
export interface DriverMapMarker {
  driverId: number;
  driverName: string;
  vehiclePlateNumber: string | null;
  latitude: number;
  longitude: number;
  status: DriverPresenceState;
  currentBooking: { id: number; girlName: string } | null;
  lastGpsUpdateAt: string;
}

export function combineDriverMarkers(
  locations: DriverLocationEntry[],
  presence: DriverPresenceEntry[]
): DriverMapMarker[] {
  const presenceByDriverId = new Map(presence.map((p) => [p.driverId, p]));

  return locations.flatMap((location) => {
    const entry = presenceByDriverId.get(location.driverId);
    if (!entry) return [];
    return [
      {
        driverId: location.driverId,
        driverName: entry.driverName,
        vehiclePlateNumber: entry.vehiclePlateNumber,
        latitude: location.latitude,
        longitude: location.longitude,
        status: entry.status,
        currentBooking: entry.currentBooking,
        lastGpsUpdateAt: location.updatedAt
      }
    ];
  });
}

export interface BookingMapMarker {
  bookingId: number;
  girlName: string;
  pickupLocation: string | null;
  latitude: number;
  longitude: number;
}

/** 一张 Booking 可能有多个 Waiting Leg（去程/回程），只取每个 bookingId 第一笔当代表性 Pickup Marker。 */
export function combineBookingMarkers(waitingLegs: DispatchWaitingLeg[]): BookingMapMarker[] {
  const seen = new Set<number>();
  const markers: BookingMapMarker[] = [];

  for (const leg of waitingLegs) {
    if (seen.has(leg.bookingId)) continue;
    if (leg.pickupLatitude === null || leg.pickupLongitude === null) continue;
    seen.add(leg.bookingId);
    markers.push({
      bookingId: leg.bookingId,
      girlName: leg.girlName,
      pickupLocation: leg.pickupLocation,
      latitude: leg.pickupLatitude,
      longitude: leg.pickupLongitude
    });
  }

  return markers;
}
