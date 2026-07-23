import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import * as bookingsService from "../bookings/bookings.service.js";
import * as dispatchService from "./dispatch.service.js";

async function createTestDriver(name: string, overrides: Partial<{ phone: string }> = {}) {
  return prisma.driver.create({ data: { name, phone: overrides.phone } });
}

let driverIds: number[] = [];
let bookingIds: number[] = [];

beforeEach(() => {
  driverIds = [];
  bookingIds = [];
});

afterEach(async () => {
  await prisma.driverLocation.deleteMany({ where: { driverId: { in: driverIds } } });
  await prisma.leg.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
});

describe("Dispatch Center aggregation (Module 6 scenarios)", () => {
  it("listWaitingBookings shows unfinished legs and excludes completed/cancelled ones", async () => {
    const booking = await bookingsService.createBooking({
      girlName: "DispatchWaitingTest",
      totalAmountCents: 0,
      legs: [
        { pickupLocation: "A", dropoffLocation: "B" },
        { pickupLocation: "C", dropoffLocation: "D" }
      ]
    });
    bookingIds.push(booking.id);

    const [leg1, leg2] = booking.legs;
    await prisma.leg.update({ where: { id: leg2.id }, data: { status: "CANCELLED" } });

    const results = await dispatchService.listWaitingBookings({});
    const legIds = results.map((r) => r.legId);

    expect(legIds).toContain(leg1.id);
    expect(legIds).not.toContain(leg2.id);
  });

  it("WAITING filter includes both PENDING and REJECTED legs", async () => {
    const driver = await createTestDriver("Filter Waiting Driver");
    driverIds.push(driver.id);
    const booking = await bookingsService.createBooking({
      girlName: "DispatchFilterWaiting",
      totalAmountCents: 0,
      legs: [{ pickupLocation: "A", dropoffLocation: "B" }, { pickupLocation: "C", dropoffLocation: "D" }]
    });
    bookingIds.push(booking.id);
    const [pendingLeg, rejectedLeg] = booking.legs;
    await prisma.leg.update({
      where: { id: rejectedLeg.id },
      data: { status: "REJECTED", driverId: driver.id, rejectionReason: "Too far" }
    });

    const results = await dispatchService.listWaitingBookings({ filter: "WAITING" });
    const legIds = results.map((r) => r.legId);

    expect(legIds).toContain(pendingLeg.id);
    expect(legIds).toContain(rejectedLeg.id);
    expect(results.find((r) => r.legId === rejectedLeg.id)?.rejectionReason).toBe("Too far");
  });

  it("ASSIGNED filter only shows ASSIGNED legs, not ACCEPTED ones", async () => {
    const driver = await createTestDriver("Filter Assigned Driver");
    driverIds.push(driver.id);
    const booking = await bookingsService.createBooking({
      girlName: "DispatchFilterAssigned",
      totalAmountCents: 0,
      legs: [{ pickupLocation: "A", dropoffLocation: "B" }, { pickupLocation: "C", dropoffLocation: "D" }]
    });
    bookingIds.push(booking.id);
    const [assignedLeg, acceptedLeg] = booking.legs;
    await prisma.leg.update({ where: { id: assignedLeg.id }, data: { status: "ASSIGNED", driverId: driver.id } });
    await prisma.leg.update({ where: { id: acceptedLeg.id }, data: { status: "ACCEPTED", driverId: driver.id } });

    const results = await dispatchService.listWaitingBookings({ filter: "ASSIGNED" });
    const legIds = results.map((r) => r.legId);

    expect(legIds).toContain(assignedLeg.id);
    expect(legIds).not.toContain(acceptedLeg.id);
  });

  it("derives priority from how long the booking has been waiting", async () => {
    const freshBooking = await bookingsService.createBooking({
      girlName: "DispatchFreshPriority",
      totalAmountCents: 0,
      legs: [{ pickupLocation: "A", dropoffLocation: "B" }]
    });
    bookingIds.push(freshBooking.id);

    const urgentBooking = await bookingsService.createBooking({
      girlName: "DispatchUrgentPriority",
      totalAmountCents: 0,
      legs: [{ pickupLocation: "A", dropoffLocation: "B" }]
    });
    bookingIds.push(urgentBooking.id);
    await prisma.booking.update({
      where: { id: urgentBooking.id },
      data: { createdAt: new Date(Date.now() - 35 * 60 * 1000) }
    });

    const highBooking = await bookingsService.createBooking({
      girlName: "DispatchHighPriority",
      totalAmountCents: 0,
      legs: [{ pickupLocation: "A", dropoffLocation: "B" }]
    });
    bookingIds.push(highBooking.id);
    await prisma.booking.update({
      where: { id: highBooking.id },
      data: { createdAt: new Date(Date.now() - 15 * 60 * 1000) }
    });

    const results = await dispatchService.listWaitingBookings({});
    const priorityByBookingId = new Map(results.map((r) => [r.bookingId, r.priority]));

    expect(priorityByBookingId.get(freshBooking.id)).toBe("NORMAL");
    expect(priorityByBookingId.get(highBooking.id)).toBe("HIGH");
    expect(priorityByBookingId.get(urgentBooking.id)).toBe("URGENT");
  });

  it("search matches booking id and girlName", async () => {
    const booking = await bookingsService.createBooking({
      girlName: "UniqueSearchableName",
      totalAmountCents: 0,
      legs: [{ pickupLocation: "A", dropoffLocation: "B" }]
    });
    bookingIds.push(booking.id);

    const byName = await dispatchService.listWaitingBookings({ search: "UniqueSearchable" });
    expect(byName.map((r) => r.bookingId)).toContain(booking.id);

    const byId = await dispatchService.listWaitingBookings({ search: String(booking.id) });
    expect(byId.map((r) => r.bookingId)).toContain(booking.id);

    const noMatch = await dispatchService.listWaitingBookings({ search: "DefinitelyNotThere" });
    expect(noMatch.map((r) => r.bookingId)).not.toContain(booking.id);
  });

  it("computes driver workload counts (current/pending/completed today) correctly", async () => {
    const driver = await createTestDriver("Workload Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking({
      girlName: "DispatchWorkload",
      totalAmountCents: 0,
      legs: [
        { pickupLocation: "A", dropoffLocation: "B" },
        { pickupLocation: "C", dropoffLocation: "D" },
        { pickupLocation: "E", dropoffLocation: "F" }
      ]
    });
    bookingIds.push(booking.id);
    const [legAssigned, legAccepted, legCompleted] = booking.legs;

    await prisma.leg.update({ where: { id: legAssigned.id }, data: { status: "ASSIGNED", driverId: driver.id } });
    await prisma.leg.update({ where: { id: legAccepted.id }, data: { status: "ACCEPTED", driverId: driver.id } });
    await prisma.leg.update({
      where: { id: legCompleted.id },
      data: { status: "COMPLETED", driverId: driver.id, completedAt: new Date() }
    });

    const results = await dispatchService.listDispatchDrivers({});
    const entry = results.find((r) => r.driver.id === driver.id);

    expect(entry).toBeDefined();
    expect(entry?.currentJobs).toBe(2); // ASSIGNED + ACCEPTED，未含 COMPLETED
    expect(entry?.pendingJobs).toBe(1); // 只有 ASSIGNED
    expect(entry?.completedToday).toBe(1);
    expect(entry?.workloadStatus).toBe("BUSY");
  });

  it("GPS status is reported independently of leg status (not merged like the GPS dashboard)", async () => {
    const driver = await createTestDriver("Independent GPS Driver");
    driverIds.push(driver.id);
    await prisma.driver.update({ where: { id: driver.id }, data: { isOnline: true, onlineSince: new Date() } });
    await prisma.driverLocation.create({
      data: { driverId: driver.id, latitude: 3.1, longitude: 101.6, recordedAt: new Date() }
    });

    const booking = await bookingsService.createBooking({
      girlName: "DispatchGpsIndependence",
      totalAmountCents: 0,
      legs: [{ pickupLocation: "A", dropoffLocation: "B" }]
    });
    bookingIds.push(booking.id);
    const [leg] = booking.legs;
    await prisma.leg.update({ where: { id: leg.id }, data: { status: "PASSENGER_ON_BOARD", driverId: driver.id } });

    const results = await dispatchService.listDispatchDrivers({});
    const entry = results.find((r) => r.driver.id === driver.id);

    // GPS Dashboard (Module 5) 会把这个显示成 PASSENGER_ON_BOARD；Dispatch Center 刻意分开两个栏位，
    // gpsStatus 永远只反映纯粹的 GPS 状态。
    expect(entry?.gpsStatus).toBe("ONLINE");
    expect(entry?.currentJobs).toBe(1);
  });

  it("BUSY/IDLE filter matches workload status", async () => {
    const busyDriver = await createTestDriver("Busy Driver");
    driverIds.push(busyDriver.id);
    const idleDriver = await createTestDriver("Idle Driver");
    driverIds.push(idleDriver.id);

    const booking = await bookingsService.createBooking({
      girlName: "DispatchBusyIdle",
      totalAmountCents: 0,
      legs: [{ pickupLocation: "A", dropoffLocation: "B" }]
    });
    bookingIds.push(booking.id);
    const [leg] = booking.legs;
    await prisma.leg.update({ where: { id: leg.id }, data: { status: "ASSIGNED", driverId: busyDriver.id } });

    const busyResults = await dispatchService.listDispatchDrivers({ filter: "BUSY" });
    const idleResults = await dispatchService.listDispatchDrivers({ filter: "IDLE" });

    expect(busyResults.map((r) => r.driver.id)).toContain(busyDriver.id);
    expect(busyResults.map((r) => r.driver.id)).not.toContain(idleDriver.id);
    expect(idleResults.map((r) => r.driver.id)).toContain(idleDriver.id);
    expect(idleResults.map((r) => r.driver.id)).not.toContain(busyDriver.id);
  });

  it("search matches driver name and phone", async () => {
    const driver = await createTestDriver("SearchablePhoneDriver", { phone: "0123456789" });
    driverIds.push(driver.id);

    const byName = await dispatchService.listDispatchDrivers({ search: "SearchablePhone" });
    expect(byName.map((r) => r.driver.id)).toContain(driver.id);

    const byPhone = await dispatchService.listDispatchDrivers({ search: "0123456789" });
    expect(byPhone.map((r) => r.driver.id)).toContain(driver.id);
  });

  it("COMPLETED filter only shows legs completed on the given date, not other days or other statuses", async () => {
    const driver = await createTestDriver("Completed Filter Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking({
      girlName: "DispatchCompletedFilter",
      totalAmountCents: 0,
      legs: [
        { pickupLocation: "A", dropoffLocation: "B" },
        { pickupLocation: "C", dropoffLocation: "D" },
        { pickupLocation: "E", dropoffLocation: "F" }
      ]
    });
    bookingIds.push(booking.id);
    const [completedToday, completedYesterday, stillWaiting] = booking.legs;

    await prisma.leg.update({
      where: { id: completedToday.id },
      data: { status: "COMPLETED", driverId: driver.id, completedAt: new Date() }
    });
    await prisma.leg.update({
      where: { id: completedYesterday.id },
      data: { status: "COMPLETED", driverId: driver.id, completedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    const todayResults = await dispatchService.listWaitingBookings({ filter: "COMPLETED" });
    const todayLegIds = todayResults.map((r) => r.legId);

    expect(todayLegIds).toContain(completedToday.id);
    expect(todayLegIds).not.toContain(completedYesterday.id);
    // 不属于「已完成」的 Leg（还在等派）永远不该出现在 Completed 视图里，不管日期怎么选。
    expect(todayLegIds).not.toContain(stillWaiting.id);

    // 不给 filter 时（Waiting/Active 视图的「全部」）也不该混进已完成的 Leg。
    const defaultResults = await dispatchService.listWaitingBookings({});
    expect(defaultResults.map((r) => r.legId)).not.toContain(completedToday.id);
  });

  it("COMPLETED filter with an explicit date only shows legs completed on that day", async () => {
    const driver = await createTestDriver("Completed Date Filter Driver");
    driverIds.push(driver.id);

    const booking = await bookingsService.createBooking({
      girlName: "DispatchCompletedDateFilter",
      totalAmountCents: 0,
      legs: [{ pickupLocation: "A", dropoffLocation: "B" }]
    });
    bookingIds.push(booking.id);
    const [leg] = booking.legs;

    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await prisma.leg.update({
      where: { id: leg.id },
      data: { status: "COMPLETED", driverId: driver.id, completedAt: threeDaysAgo }
    });

    // 本地日历日期字串，跟 dispatch.service.ts 的 startOfLocalDay()（用 getFullYear/getMonth/
    // getDate，不是 UTC）保持一致——用 toISOString().slice(0,10)（UTC 日期）在非 UTC 时区
    // 会跟 completedAt 这个真实时间点的本地日期对不上，等于重现了 Settlement periodEnd
    // 那个 UTC-parse 混本地-setHours 的同一类日期边界 Bug，而不是在测 Dispatch 本身的逻辑。
    const dateStr = `${threeDaysAgo.getFullYear()}-${String(threeDaysAgo.getMonth() + 1).padStart(2, "0")}-${String(threeDaysAgo.getDate()).padStart(2, "0")}`;
    const matched = await dispatchService.listWaitingBookings({ filter: "COMPLETED", date: dateStr });
    expect(matched.map((r) => r.legId)).toContain(leg.id);

    const todayResults = await dispatchService.listWaitingBookings({ filter: "COMPLETED" });
    expect(todayResults.map((r) => r.legId)).not.toContain(leg.id);
  });

  it("listWaitingBookings exposes legType for each leg (OUTBOUND/RETURN/ADDITIONAL)", async () => {
    const booking = await bookingsService.createBooking({
      girlName: "DispatchLegType",
      totalAmountCents: 0,
      legs: [
        { legType: "OUTBOUND", pickupLocation: "A", dropoffLocation: "B" },
        { legType: "RETURN", pickupLocation: "B", dropoffLocation: "A" }
      ]
    });
    bookingIds.push(booking.id);
    const [outboundLeg, returnLeg] = booking.legs;

    const results = await dispatchService.listWaitingBookings({});
    expect(results.find((r) => r.legId === outboundLeg.id)?.legType).toBe("OUTBOUND");
    expect(results.find((r) => r.legId === returnLeg.id)?.legType).toBe("RETURN");
  });

  it("getDispatchStatistics counts match the underlying leg/driver states", async () => {
    const driver = await createTestDriver("Statistics Driver");
    driverIds.push(driver.id);
    await prisma.driver.update({ where: { id: driver.id }, data: { isOnline: true, onlineSince: new Date() } });

    const booking = await bookingsService.createBooking({
      girlName: "DispatchStatistics",
      totalAmountCents: 0,
      legs: [
        { pickupLocation: "A", dropoffLocation: "B" },
        { pickupLocation: "C", dropoffLocation: "D" }
      ]
    });
    bookingIds.push(booking.id);
    const [legWaiting, legInProgress] = booking.legs;
    await prisma.leg.update({
      where: { id: legInProgress.id },
      data: { status: "DRIVER_ARRIVING", driverId: driver.id }
    });

    const stats = await dispatchService.getDispatchStatistics();

    expect(stats.waitingBookings).toBeGreaterThanOrEqual(1);
    expect(stats.inProgress).toBeGreaterThanOrEqual(1);
    expect(stats.onlineDrivers).toBeGreaterThanOrEqual(1);
    // 只是确认查得到，不对全局总数做精确断言（其他测试并行跑，全局计数不是这个测试能控制的）。
    expect(legWaiting).toBeDefined();
  });
});
