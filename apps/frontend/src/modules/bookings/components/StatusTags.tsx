import { Tag } from "antd";
import type { BookingStatus, LegStatus, LegType } from "../../../types/booking";

const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: "待处理",
  IN_PROGRESS: "进行中",
  COMPLETED: "已完成",
  CANCELLED: "已取消"
};

const BOOKING_STATUS_COLOR: Record<BookingStatus, string> = {
  PENDING: "default",
  IN_PROGRESS: "processing",
  COMPLETED: "success",
  CANCELLED: "error"
};

export function BookingStatusTag({ status }: { status: BookingStatus }) {
  return <Tag color={BOOKING_STATUS_COLOR[status]}>{BOOKING_STATUS_LABEL[status]}</Tag>;
}

const LEG_STATUS_LABEL: Record<LegStatus, string> = {
  PENDING: "未指派",
  ASSIGNED: "待接受",
  ACCEPTED: "已接受",
  DRIVER_ARRIVING: "司机前往中",
  PASSENGER_ON_BOARD: "乘客已上车",
  COMPLETED: "已完成",
  REJECTED: "已拒绝",
  CANCELLED: "已取消"
};

const LEG_STATUS_COLOR: Record<LegStatus, string> = {
  PENDING: "default",
  ASSIGNED: "gold",
  ACCEPTED: "blue",
  DRIVER_ARRIVING: "processing",
  PASSENGER_ON_BOARD: "processing",
  COMPLETED: "success",
  REJECTED: "error",
  CANCELLED: "default"
};

export function LegStatusTag({ status }: { status: LegStatus }) {
  return <Tag color={LEG_STATUS_COLOR[status]}>{LEG_STATUS_LABEL[status]}</Tag>;
}

export const LEG_TYPE_LABEL: Record<LegType, string> = {
  OUTBOUND: "去程",
  RETURN: "回程",
  ADDITIONAL: "额外行程"
};

const LEG_TYPE_COLOR: Record<LegType, string> = {
  OUTBOUND: "blue",
  RETURN: "purple",
  ADDITIONAL: "default"
};

export function LegTypeTag({ legType }: { legType: LegType }) {
  return <Tag color={LEG_TYPE_COLOR[legType]}>{LEG_TYPE_LABEL[legType]}</Tag>;
}
