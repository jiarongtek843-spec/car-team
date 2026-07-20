import { useMemo, useState } from "react";
import { Empty, Skeleton, Tabs, Typography } from "antd";
import { useMyLegsQuery } from "./hooks";
import { JobCard } from "./components/JobCard";
import { RejectLegModal } from "./components/RejectLegModal";
import type { DriverLeg } from "./types";

type BucketKey = "awaiting" | "upcoming" | "inProgress" | "completed" | "closed";

const BUCKETS: { key: BucketKey; label: string; statuses: DriverLeg["status"][] }[] = [
  { key: "awaiting", label: "待接受", statuses: ["ASSIGNED"] },
  { key: "upcoming", label: "即将进行", statuses: ["ACCEPTED"] },
  { key: "inProgress", label: "进行中", statuses: ["DRIVER_ARRIVING", "PASSENGER_ON_BOARD"] },
  { key: "completed", label: "已完成", statuses: ["COMPLETED"] },
  { key: "closed", label: "已拒绝或已取消", statuses: ["REJECTED", "CANCELLED"] }
];

export function DriverJobPage() {
  const { data: legs, isLoading } = useMyLegsQuery();
  const [rejectingLegId, setRejectingLegId] = useState<number | null>(null);

  const grouped = useMemo(() => {
    const result: Record<BucketKey, DriverLeg[]> = {
      awaiting: [],
      upcoming: [],
      inProgress: [],
      completed: [],
      closed: []
    };
    for (const leg of legs ?? []) {
      const bucket = BUCKETS.find((b) => b.statuses.includes(leg.status));
      if (bucket) {
        result[bucket.key].push(leg);
      }
    }
    return result;
  }, [legs]);

  if (isLoading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active />
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4}>我的工作</Typography.Title>
      <Tabs
        items={BUCKETS.map((bucket) => ({
          key: bucket.key,
          label: `${bucket.label} (${grouped[bucket.key].length})`,
          children:
            grouped[bucket.key].length === 0 ? (
              <Empty description="没有资料" />
            ) : (
              grouped[bucket.key].map((leg) => <JobCard key={leg.id} leg={leg} onReject={setRejectingLegId} />)
            )
        }))}
      />

      <RejectLegModal legId={rejectingLegId} onClose={() => setRejectingLegId(null)} />
    </div>
  );
}
