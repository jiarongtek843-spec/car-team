import { Card, Empty, Skeleton, Tag, Timeline, Typography } from "antd";
import dayjs from "dayjs";
import { useBookingTimelineQuery } from "../hooks";
import type { TimelineEvent, TimelineEventType } from "../timelineTypes";

const EVENT_COLOR: Record<TimelineEventType, string> = {
  BOOKING_CREATED: "gray",
  OFFER_SENT: "blue",
  DRIVER_ACCEPTED: "cyan",
  DRIVER_ARRIVED: "orange",
  PASSENGER_ON_BOARD: "purple",
  COMPLETED: "green"
};

const LEG_TYPE_LABEL: Record<string, string> = {
  OUTBOUND: "去程",
  RETURN: "回程",
  ADDITIONAL: "额外行程"
};

function formatTimestamp(value: string) {
  return dayjs(value).format("YYYY-MM-DD (ddd) HH:mm");
}

function eventLabel(event: TimelineEvent) {
  if (!event.legType || !event.legSequence) return event.label;
  const legLabel = LEG_TYPE_LABEL[event.legType] ?? event.legType;
  return `${event.label}（${legLabel} #${event.legSequence}）`;
}

export function BookingTimelineCard({ bookingId }: { bookingId: number }) {
  const { data: timeline, isLoading } = useBookingTimelineQuery(bookingId);

  return (
    <Card title="Timeline" style={{ marginBottom: 24 }}>
      {isLoading ? (
        <Skeleton active />
      ) : !timeline || timeline.events.length === 0 ? (
        <Empty description="还没有任何事件纪录" />
      ) : (
        <Timeline
          items={timeline.events.map((event) => ({
            color: EVENT_COLOR[event.type],
            children: (
              <div key={`${event.type}-${event.timestamp}-${event.legId ?? "none"}`}>
                <Typography.Text strong>{eventLabel(event)}</Typography.Text>
                <div>
                  <Typography.Text type="secondary">{formatTimestamp(event.timestamp)}</Typography.Text>
                  {event.driver && <Tag style={{ marginLeft: 8 }}>{event.driver.name}</Tag>}
                </div>
              </div>
            )
          }))}
        />
      )}
    </Card>
  );
}
