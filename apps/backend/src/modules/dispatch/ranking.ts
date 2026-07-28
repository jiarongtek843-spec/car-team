/**
 * Phase 1 Driver Ranking Engine（docs/design/phase2-gps-dispatch-architecture.md §3.2）。
 * 只对 Eligibility Engine 已经放行的 Driver 排序，不重新判断谁能不能收到 Offer。
 * Phase 1 只有一个真正的排序条件（距离）；没有 GPS/上车点坐标时退回一个单纯的
 * tie-breaker（今日已完成趟数由少到多），不是一个额外的评分规则。
 */

export function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const EARTH_RADIUS_KM = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export interface RankingCandidateDriver {
  id: number;
  latitude: number | null;
  longitude: number | null;
  completedToday: number;
}

export interface RankingContext {
  /** Leg 目前没有上车点坐标栏位（见设计文件 §6.7），所以这里几乎总是 null——
   * 距离排序会整批退回 tie-breaker，这是预期行为，不是缺陷。 */
  pickupLatitude: number | null;
  pickupLongitude: number | null;
}

export interface RankedDriver<T> {
  candidate: T;
  /** null 代表这个 Driver 或这个 Leg 缺坐标，排序时退回 tie-breaker，不代表距离是 0。 */
  distanceKm: number | null;
}

export function rankDrivers<T extends RankingCandidateDriver>(
  eligible: T[],
  ctx: RankingContext
): RankedDriver<T>[] {
  const withDistance: RankedDriver<T>[] = eligible.map((candidate) => ({
    candidate,
    distanceKm:
      ctx.pickupLatitude !== null &&
      ctx.pickupLongitude !== null &&
      candidate.latitude !== null &&
      candidate.longitude !== null
        ? haversineDistanceKm(ctx.pickupLatitude, ctx.pickupLongitude, candidate.latitude, candidate.longitude)
        : null
  }));

  return withDistance.sort((a, b) => {
    if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
    if (a.distanceKm !== null) return -1;
    if (b.distanceKm !== null) return 1;
    return a.candidate.completedToday - b.candidate.completedToday;
  });
}
