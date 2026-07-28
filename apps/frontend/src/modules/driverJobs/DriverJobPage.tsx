import { useMemo, useState } from "react";
import { Card, Col, Empty, Row, Skeleton, Space, Statistic, Tabs, Tag, Typography } from "antd";
import { useMyLegsQuery } from "./hooks";
import { JobCard } from "./components/JobCard";
import { PendingOffersPanel } from "./components/PendingOffersPanel";
import { RejectLegModal } from "./components/RejectLegModal";
import type { DriverLeg } from "./types";
import { useIsMobile } from "../../common/useIsMobile";
import { DriverPresenceToggle } from "../gps/components/DriverPresenceToggle";
import { useMyWalletSummaryQuery } from "../wallet/hooks";
import { formatCents } from "../../lib/money";

type BucketKey = "awaiting" | "upcoming" | "inProgress" | "completed" | "closed";

const BUCKETS: { key: BucketKey; label: string; statuses: DriverLeg["status"][] }[] = [
  { key: "awaiting", label: "待接受", statuses: ["ASSIGNED"] },
  { key: "upcoming", label: "即将进行", statuses: ["ACCEPTED"] },
  { key: "inProgress", label: "进行中", statuses: ["DRIVER_ARRIVING", "PASSENGER_ON_BOARD"] },
  { key: "completed", label: "已完成", statuses: ["COMPLETED"] },
  { key: "closed", label: "已拒绝或已取消", statuses: ["REJECTED", "CANCELLED"] }
];

function LegSummaryLine({ leg }: { leg: DriverLeg }) {
  return (
    <Space direction="vertical" size={0}>
      <Typography.Text strong>
        #{leg.booking.id} {leg.booking.girlName}
      </Typography.Text>
      <Typography.Text type="secondary">
        {leg.pickupLocation ?? "—"} → {leg.dropoffLocation ?? "—"}
      </Typography.Text>
    </Space>
  );
}

export function DriverJobPage() {
  const { data: legs, isLoading } = useMyLegsQuery();
  const { data: walletSummary } = useMyWalletSummaryQuery();
  const [rejectingLegId, setRejectingLegId] = useState<number | null>(null);
  const isMobile = useIsMobile();

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

  const currentJob = grouped.inProgress[0] ?? grouped.upcoming[0] ?? null;
  const nextJob = grouped.awaiting[0] ?? null;

  if (isLoading) {
    return (
      <div style={{ padding: isMobile ? 12 : 24 }}>
        <Skeleton active />
      </div>
    );
  }

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <Typography.Title level={4}>我的工作</Typography.Title>

      <PendingOffersPanel />

      {/* Mobile First UI Remediation：Driver Portal 首页要「一眼看到」四件事——
          自己在线还是离线、手上现在有没有工作、下一个工作是什么、今天赚了多少——
          不用先点进 Tab 才看得到。这一段在桌面上也显示（不是手机专属），只是手机
          用单栏 Row（xs=24），桌面用一排四个（sm=6）。 */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={6}>
          <Card size="small">
            <Space direction="vertical" size={4}>
              <Typography.Text type="secondary">在线状态</Typography.Text>
              <DriverPresenceToggle light />
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small">
            <Statistic title="今日收入" value={formatCents(walletSummary?.todayPendingCents)} />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small">
            <Typography.Text type="secondary">待接受工作</Typography.Text>
            <div>
              <Tag color={grouped.awaiting.length > 0 ? "gold" : "default"} style={{ fontSize: 16, padding: "4px 12px", marginTop: 4 }}>
                {grouped.awaiting.length} 笔
              </Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small">
            <Typography.Text type="secondary">进行中</Typography.Text>
            <div>
              <Tag color={grouped.inProgress.length > 0 ? "processing" : "default"} style={{ fontSize: 16, padding: "4px 12px", marginTop: 4 }}>
                {grouped.inProgress.length} 笔
              </Tag>
            </div>
          </Card>
        </Col>
      </Row>

      {(currentJob || nextJob) && (
        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
          {currentJob && (
            <Col xs={24} sm={12}>
              <Card size="small" title="Current Job" styles={{ body: { paddingBottom: 8 } }}>
                <LegSummaryLine leg={currentJob} />
              </Card>
            </Col>
          )}
          {nextJob && (
            <Col xs={24} sm={12}>
              <Card size="small" title="Next Job" styles={{ body: { paddingBottom: 8 } }}>
                <LegSummaryLine leg={nextJob} />
              </Card>
            </Col>
          )}
        </Row>
      )}

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
