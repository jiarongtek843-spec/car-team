import { useEffect, useMemo, useState } from "react";
import { Alert, Card, Col, Empty, Row, Skeleton, Space, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useDriverLocationsQuery } from "../gps/hooks";
import { useDriverPresenceQuery } from "../driverPresence/hooks";
import { useWaitingBookingsQuery, useMatchingQuery } from "../dispatch/hooks";
import { PRESENCE_STATE_COLOR, PRESENCE_STATE_LABELS } from "../driverPresence/types";
import { useIsMobile } from "../../common/useIsMobile";
import { useCompanySettings } from "../companySettings/CompanySettingsContext";
import { combineBookingMarkers, combineDriverMarkers, type BookingMapMarker, type DriverMapMarker } from "./markers";
import { createBookingIcon, createDriverIcon, DRIVER_MARKER_COLOR } from "./mapIcons";

/** CompanySettings 还没加载完成时的保底值，跟 gps.service.ts 的 CONNECTION_LOST_THRESHOLD_SECONDS 一致。 */
const DEFAULT_STALE_THRESHOLD_SECONDS = 30;

// 没有任何 Marker 时的预设中心/缩放——纯粹是一个合理的起始视角，不代表任何业务意义。
const DEFAULT_CENTER: [number, number] = [3.139, 101.6869];
const DEFAULT_ZOOM = 12;

type Selection = { type: "driver"; driverId: number } | { type: "booking"; bookingId: number } | null;

function FitBounds({ driverMarkers, bookingMarkers }: { driverMarkers: DriverMapMarker[]; bookingMarkers: BookingMapMarker[] }) {
  const map = useMap();

  useEffect(() => {
    const points: [number, number][] = [
      ...driverMarkers.map((d) => [d.latitude, d.longitude] as [number, number]),
      ...bookingMarkers.map((b) => [b.latitude, b.longitude] as [number, number])
    ];
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], DEFAULT_ZOOM);
      return;
    }
    map.fitBounds(points, { padding: [40, 40] });
    // 只在 Marker 的「数量」变动时重新对焦——单纯位置微幅更新（每 5 秒轮询一次）不该
    // 打断 Dispatcher 正在操作的视角（缩放/平移）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverMarkers.length, bookingMarkers.length]);

  return null;
}

function formatUpdatedAt(value: string) {
  return dayjs(value).format("HH:mm:ss");
}

export function LiveDispatchMapPage() {
  const isMobile = useIsMobile();
  const [selection, setSelection] = useState<Selection>(null);
  const companySettings = useCompanySettings();

  const locationsQuery = useDriverLocationsQuery();
  const presenceQuery = useDriverPresenceQuery();
  const waitingLegsQuery = useWaitingBookingsQuery("WAITING", "");
  const { data: locations } = locationsQuery;
  const { data: presence } = presenceQuery;
  const { data: waitingLegs } = waitingLegsQuery;

  // GPS 上传是 Driver 分页背景执行的 JS 计时器——手机锁屏/切到别的 App 之后系统会暂停甚至
  // 直接终止背景分页的计时器，Driver 这之后就不会再有新的定位，但既有逻辑完全没有任何
  // 提示，Marker 会维持原本状态的实心颜色继续停在最后一个已知位置，让 Dispatcher 误以为
  // 那就是即时位置。这里用跟 Driver Presence 的 CONNECTION_LOST 判定同一个阈值
  // （connectionLostTimeoutSeconds）：超过这段时间没有新定位，就视为「可能过期」。
  const staleThresholdMs = (companySettings?.connectionLostTimeoutSeconds ?? DEFAULT_STALE_THRESHOLD_SECONDS) * 1000;
  function isDriverStale(driver: DriverMapMarker) {
    return Date.now() - new Date(driver.lastGpsUpdateAt).getTime() > staleThresholdMs;
  }

  // Stabilization Bug Fix：之前完全没有 isLoading/isError 处理，第一次载入或任何一次
  // Poll 失败时地图就是「零 Marker」，跟「真的没有司机在线」长得一模一样——对 Dispatch
  // 这种时效性画面来说很危险，Dispatcher 可能误以为没人在线而不去查真正的原因。
  const isInitialLoading = locationsQuery.isLoading || presenceQuery.isLoading || waitingLegsQuery.isLoading;
  const isError = locationsQuery.isError || presenceQuery.isError || waitingLegsQuery.isError;

  const driverMarkers = useMemo(() => combineDriverMarkers(locations ?? [], presence ?? []), [locations, presence]);
  const bookingMarkers = useMemo(() => combineBookingMarkers(waitingLegs ?? []), [waitingLegs]);
  const hasNoData = !isInitialLoading && !isError && driverMarkers.length === 0 && bookingMarkers.length === 0;

  const selectedDriver = selection?.type === "driver" ? driverMarkers.find((d) => d.driverId === selection.driverId) : null;
  const selectedBooking = selection?.type === "booking" ? bookingMarkers.find((b) => b.bookingId === selection.bookingId) : null;

  const { data: matching, isFetching: matchingLoading } = useMatchingQuery(selection?.type === "booking" ? selection.bookingId : null);

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <Typography.Title level={4}>Live Dispatch Map</Typography.Title>
      <Typography.Paragraph type="secondary">
        Driver 位置来自 GPS Foundation，状态来自 Driver Presence，点选 Booking Marker 的候选名单来自 Driver Matching
        Engine——这个画面单纯把三个既有模块的资料画在地图上，不做 Auto Assignment、不画路线、不算 ETA。
      </Typography.Paragraph>

      {isError && (
        <Alert
          type="warning"
          showIcon
          message="部分资料更新失败"
          description="Driver 位置/状态或 Booking 清单有一部分抓取失败，画面上的资料可能不是最新——请勿单靠这个画面判断目前完全没有司机在线，建议重新整理或改看 Dispatch Center 确认。"
          style={{ marginBottom: 16 }}
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card size="small" styles={{ body: { padding: isInitialLoading ? 16 : 0 } }}>
            {isInitialLoading ? (
              <Skeleton active paragraph={{ rows: 8 }} style={{ height: isMobile ? 360 : 560 }} />
            ) : (
              <>
                {hasNoData && (
                  <Empty
                    description="目前没有司机在线、也没有等待中的 Booking Pickup"
                    style={{ padding: 16 }}
                  />
                )}
                <MapContainer
                  center={DEFAULT_CENTER}
                  zoom={DEFAULT_ZOOM}
                  style={{ height: isMobile ? 360 : 560, width: "100%" }}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <FitBounds driverMarkers={driverMarkers} bookingMarkers={bookingMarkers} />

                  {driverMarkers.map((driver) => (
                    <Marker
                      key={`driver-${driver.driverId}`}
                      position={[driver.latitude, driver.longitude]}
                      icon={createDriverIcon(driver.status, isDriverStale(driver))}
                      eventHandlers={{ click: () => setSelection({ type: "driver", driverId: driver.driverId }) }}
                    >
                      <Popup>
                        <strong>{driver.driverName}</strong>
                        <br />
                        {PRESENCE_STATE_LABELS[driver.status]}
                        {isDriverStale(driver) && (
                          <>
                            <br />
                            <span style={{ color: "#8c8c8c" }}>位置可能已过期（{formatUpdatedAt(driver.lastGpsUpdateAt)}）</span>
                          </>
                        )}
                      </Popup>
                    </Marker>
                  ))}

                  {bookingMarkers.map((booking) => (
                    <Marker
                      key={`booking-${booking.bookingId}`}
                      position={[booking.latitude, booking.longitude]}
                      icon={createBookingIcon()}
                      eventHandlers={{ click: () => setSelection({ type: "booking", bookingId: booking.bookingId }) }}
                    >
                      <Popup>
                        <strong>#{booking.bookingId}</strong> {booking.girlName}
                        <br />
                        {booking.pickupLocation}
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </>
            )}
          </Card>

          <Card size="small" title="Legend" style={{ marginTop: 16 }}>
            <Space wrap>
              {(Object.keys(PRESENCE_STATE_LABELS) as Array<keyof typeof PRESENCE_STATE_LABELS>).map((status) => (
                <Tag key={status} color={PRESENCE_STATE_COLOR[status]}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: DRIVER_MARKER_COLOR[status],
                      marginRight: 4
                    }}
                  />
                  {PRESENCE_STATE_LABELS[status]}
                </Tag>
              ))}
              <Tag color="purple">▲ Booking Pickup</Tag>
              <Tag style={{ borderStyle: "dashed", borderColor: "#8c8c8c", color: "#8c8c8c" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: DRIVER_MARKER_COLOR.OFFLINE,
                    opacity: 0.55,
                    marginRight: 4
                  }}
                />
                位置可能过期
              </Tag>
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card size="small" title="Details">
            {selectedDriver && (
              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                <Typography.Text strong>{selectedDriver.driverName}</Typography.Text>
                {selectedDriver.vehiclePlateNumber && (
                  <Typography.Text type="secondary">{selectedDriver.vehiclePlateNumber}</Typography.Text>
                )}
                <Tag color={PRESENCE_STATE_COLOR[selectedDriver.status]}>{PRESENCE_STATE_LABELS[selectedDriver.status]}</Tag>
                <Typography.Text>
                  Current Booking:{" "}
                  {selectedDriver.currentBooking ? `#${selectedDriver.currentBooking.id} ${selectedDriver.currentBooking.girlName}` : "-"}
                </Typography.Text>
                <Typography.Text type="secondary">Last GPS Update: {formatUpdatedAt(selectedDriver.lastGpsUpdateAt)}</Typography.Text>
                {isDriverStale(selectedDriver) && (
                  <Alert
                    type="warning"
                    showIcon
                    message="位置可能已过期"
                    description="Driver 的手机可能锁屏或切到背景，网页暂停了定位上传——目前显示的是最后一次收到的位置，不代表他现在真的在这里。等他重新打开网页就会恢复。"
                  />
                )}
              </Space>
            )}

            {selectedBooking && (
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                <Typography.Text strong>
                  #{selectedBooking.bookingId} {selectedBooking.girlName}
                </Typography.Text>
                <Typography.Text type="secondary">Pickup: {selectedBooking.pickupLocation ?? "-"}</Typography.Text>
                <Typography.Text strong>Nearby Drivers</Typography.Text>
                <Table
                  size="small"
                  loading={matchingLoading}
                  pagination={false}
                  rowKey="driverId"
                  dataSource={matching?.candidates ?? []}
                  locale={{ emptyText: "没有符合条件的 Driver" }}
                  columns={[
                    { title: "#", dataIndex: "rank", width: 32 },
                    { title: "Driver", dataIndex: "driverName" },
                    {
                      title: "Distance",
                      dataIndex: "distanceKm",
                      render: (value: number | null) => (value === null ? "-" : `${value.toFixed(2)} km`)
                    }
                  ]}
                />
              </Space>
            )}

            {!selectedDriver && !selectedBooking && <Empty description="点选地图上的 Marker 查看详情" />}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
