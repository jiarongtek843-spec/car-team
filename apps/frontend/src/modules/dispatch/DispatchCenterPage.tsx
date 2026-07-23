import { useState } from "react";
import { Card, Col, Drawer, Row, Statistic, Tabs, Typography } from "antd";
import { useDispatchStatisticsQuery } from "./hooks";
import { WaitingBookingsPanel } from "./components/WaitingBookingsPanel";
import { DriverListPanel } from "./components/DriverListPanel";
import type { DispatchWaitingLeg } from "./types";
import { useIsMobile } from "../../common/useIsMobile";

export function DispatchCenterPage() {
  const [selectedLeg, setSelectedLeg] = useState<DispatchWaitingLeg | null>(null);
  const [driverSheetOpen, setDriverSheetOpen] = useState(false);
  const { data: stats } = useDispatchStatisticsQuery();
  const isMobile = useIsMobile();

  function handleSelectLegMobile(leg: DispatchWaitingLeg) {
    setSelectedLeg(leg);
    setDriverSheetOpen(true);
  }

  function handleAssignedMobile() {
    setSelectedLeg(null);
    setDriverSheetOpen(false);
  }

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <Typography.Title level={4}>Dispatch Center</Typography.Title>

      {/* Mobile Phase 1：6 个统计方块原本固定 span=4（一排 6 个），手机上会挤爆。
          改成响应式：手机 2 个一排，平板 3 个一排，桌面维持一排 6 个。 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Waiting Booking" value={stats?.waitingBookings ?? 0} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Assigned" value={stats?.assigned ?? 0} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="In Progress" value={stats?.inProgress ?? 0} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Completed Today" value={stats?.completedToday ?? 0} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Online Driver" value={stats?.onlineDrivers ?? 0} valueStyle={{ color: "#3f8600" }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Offline Driver" value={stats?.offlineDrivers ?? 0} />
          </Card>
        </Col>
      </Row>

      {/* Mobile First UI Remediation：手机上把「Waiting / Drivers」两栏堆叠改成三个
          Tab（Waiting Jobs / Drivers / Active Jobs）——堆叠版本要一直往下滑才看得到
          司机列表，Tab 版本一次只专注一件事，比较符合单手操作。Active Jobs 复用
          WaitingBookingsPanel、只是预设 Filter 换成 IN_PROGRESS，不是新页面/新
          API。选一笔 Leg 会直接从底部弹出 Driver Bottom Sheet，不需要使用者自己
          切去 Drivers Tab——这是 Quick Assign 流程的核心（先选 Leg，再选 Driver，
          点了就立刻指派）。「Drivers」这个 Tab 仍然保留，给单纯想浏览司机名单、
          还没决定要指派哪一笔的情境用。桌面维持原本左右两栏，不受影响。 */}
      {isMobile ? (
        <>
          <Tabs
            items={[
              {
                key: "waiting",
                label: "Waiting Jobs",
                children: (
                  <WaitingBookingsPanel
                    selectedLegId={selectedLeg?.legId ?? null}
                    onSelectLeg={handleSelectLegMobile}
                    defaultFilter="WAITING"
                  />
                )
              },
              {
                key: "drivers",
                label: "Drivers",
                children: <DriverListPanel selectedLeg={selectedLeg} onAssigned={handleAssignedMobile} />
              },
              {
                key: "active",
                label: "Active Jobs",
                children: (
                  <WaitingBookingsPanel
                    selectedLegId={selectedLeg?.legId ?? null}
                    onSelectLeg={handleSelectLegMobile}
                    defaultFilter="IN_PROGRESS"
                    title="Active Jobs"
                  />
                )
              }
            ]}
          />
          <Drawer
            title="选择 Driver"
            placement="bottom"
            height="80%"
            open={driverSheetOpen}
            onClose={() => setDriverSheetOpen(false)}
            styles={{ body: { padding: 12 } }}
          >
            <DriverListPanel selectedLeg={selectedLeg} onAssigned={handleAssignedMobile} />
          </Drawer>
        </>
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <WaitingBookingsPanel selectedLegId={selectedLeg?.legId ?? null} onSelectLeg={setSelectedLeg} />
          </Col>
          <Col xs={24} lg={12}>
            <DriverListPanel selectedLeg={selectedLeg} onAssigned={() => setSelectedLeg(null)} />
          </Col>
        </Row>
      )}
    </div>
  );
}
