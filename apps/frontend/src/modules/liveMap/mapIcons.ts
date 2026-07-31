import { DivIcon } from "leaflet";
import type { DriverPresenceState } from "../driverPresence/types";

/**
 * 跟 driverPresence/types.ts 的 PRESENCE_STATE_COLOR 用同一套配色语意（Green=Available/
 * Blue=On Trip/Orange=Pending Offer），只是那边是给 antd Tag 用的颜色名字（"success"/
 * "orange"…），Marker 需要实际的 hex 值，所以另外定义一份、颜色语意保持一致，不是重新
 * 设计一套新配色。BREAK/OFFLINE 理论上不会真的出现在地图上（见 markers.ts 的说明），
 * 颜色定义只是保留完整性，避免 TypeScript 的 Record 缺 key。
 */
export const DRIVER_MARKER_COLOR: Record<DriverPresenceState, string> = {
  OFFLINE: "#bfbfbf",
  AVAILABLE: "#52c41a",
  PENDING_OFFER: "#fa8c16",
  ACCEPTED_JOB: "#13c2c2",
  ON_TRIP: "#1677ff",
  BREAK: "#bfbfbf"
};

const BOOKING_MARKER_COLOR = "#722ed1";

/** 用 DivIcon 画简单的实心圆点，不用 Leaflet 预设的 Marker 图片——避免 Vite 打包后
 * 预设 icon 图片路径失效的经典问题，同时方便直接套用跟 Driver Status Board 一致的配色。
 * Mobile Responsiveness Pass：原本 16px 的点触控目标偏小，手指点在地图上容易点不中，
 * 稍微加大到 22px（视觉上还是一个小圆点，不影响地图整体的资讯密度/易读性）。
 *
 * GPS 上传是网页分页背景执行的 JS 计时器——手机锁屏、切到别的 App 之后，系统会暂停甚至
 * 直接终止背景分页的计时器（iOS Safari 尤其严格），Driver 在这之后就不会再有新的定位，
 * 但先前既有逻辑完全没有任何提示，Marker 还是维持原本状态的实心颜色停在最后一个已知位置，
 * 让 Dispatcher 误以为「这个人真的一直在这里，位置资料是即时的」，唯一能重新看到准确位置
 * 的方法是叫 Driver 手动切一次 Offline/Online。isStale=true 时改成半透明 + 灰色虚线外框，
 * 让「资料可能过期」这件事一眼就看得出来，不需要理解背后的技术原因。 */
export function createDriverIcon(status: DriverPresenceState, isStale = false) {
  const color = isStale ? DRIVER_MARKER_COLOR.OFFLINE : DRIVER_MARKER_COLOR[status];
  const border = isStale ? "2px dashed #8c8c8c" : "2px solid #fff";
  const opacity = isStale ? 0.55 : 1;
  return new DivIcon({
    className: "live-map-driver-marker",
    html: `<span style="display:block;width:22px;height:22px;border-radius:50%;background:${color};border:${border};box-shadow:0 0 2px rgba(0,0,0,0.5);opacity:${opacity};"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
}

/** Booking Pickup Marker 用方形，跟圆形的 Driver Marker 一眼就能区分开。同样放大到接近
 * Driver Marker 的触控尺寸。 */
export function createBookingIcon() {
  return new DivIcon({
    className: "live-map-booking-marker",
    html: `<span style="display:block;width:20px;height:20px;background:${BOOKING_MARKER_COLOR};border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,0.5);transform:rotate(45deg);"></span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
}
