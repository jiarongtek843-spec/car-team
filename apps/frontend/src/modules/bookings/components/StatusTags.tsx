import { Tag } from "antd";
import type { BookingStatus, LegStatus } from "../../../types/booking";

const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: "待处理",
  IN_PROGRESS: "进行中",
  COMPLETED: "已完成",
  CANCELLED: "已取消"
};

const STATUS_COLOR: Record<BookingStatus, string> = {
  PENDING: "default",
  IN_PROGRESS: "processing",
  COMPLETED: "success",
  CANCELLED: "error"
};

export function BookingStatusTag({ status }: { status: BookingStatus }) {
  return <Tag color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Tag>;
}

export function LegStatusTag({ status }: { status: LegStatus }) {
  return <Tag color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Tag>;
}
