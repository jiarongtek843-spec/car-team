import { useState } from "react";
import { Card, Col, Row, Statistic, Typography } from "antd";
import { useDispatchStatisticsQuery } from "./hooks";
import { WaitingBookingsPanel } from "./components/WaitingBookingsPanel";
import { DriverListPanel } from "./components/DriverListPanel";
import type { DispatchWaitingLeg } from "./types";

export function DispatchCenterPage() {
  const [selectedLeg, setSelectedLeg] = useState<DispatchWaitingLeg | null>(null);
  const { data: stats } = useDispatchStatisticsQuery();

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4}>Dispatch Center</Typography.Title>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={4}>
          <Card size="small">
            <Statistic title="Waiting Booking" value={stats?.waitingBookings ?? 0} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="Assigned" value={stats?.assigned ?? 0} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="In Progress" value={stats?.inProgress ?? 0} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="Completed Today" value={stats?.completedToday ?? 0} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="Online Driver" value={stats?.onlineDrivers ?? 0} valueStyle={{ color: "#3f8600" }} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic title="Offline Driver" value={stats?.offlineDrivers ?? 0} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={12}>
          <WaitingBookingsPanel selectedLegId={selectedLeg?.legId ?? null} onSelectLeg={setSelectedLeg} />
        </Col>
        <Col span={12}>
          <DriverListPanel selectedLeg={selectedLeg} onAssigned={() => setSelectedLeg(null)} />
        </Col>
      </Row>
    </div>
  );
}
