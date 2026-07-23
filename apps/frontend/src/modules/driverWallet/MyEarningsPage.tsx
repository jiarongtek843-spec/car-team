import { useState } from "react";
import { Card, Col, Row, Statistic, Typography } from "antd";
import { useMyTransactionsQuery, useMyWalletSummaryQuery } from "../wallet/hooks";
import { WalletTransactionTable } from "../wallet/components/WalletTransactionTable";
import { formatCents } from "../../lib/money";
import { useIsMobile } from "../../common/useIsMobile";

export function MyEarningsPage() {
  const [page, setPage] = useState(1);
  const isMobile = useIsMobile();
  const pageSize = 20;

  const { data: summary } = useMyWalletSummaryQuery();
  const { data, isLoading } = useMyTransactionsQuery({ page, pageSize });

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <Typography.Title level={4}>My Earnings</Typography.Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="Today Pending Earnings" value={formatCents(summary?.todayPendingCents)} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="Current Unsettled Earnings" value={formatCents(summary?.unsettledCents)} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="Total Settled Earnings" value={formatCents(summary?.settledCents)} />
          </Card>
        </Col>
      </Row>

      <Typography.Title level={5}>Transaction History</Typography.Title>
      <WalletTransactionTable
        data={data?.data}
        loading={isLoading}
        pagination={{ current: page, pageSize, total: data?.total ?? 0, onChange: setPage }}
      />
    </div>
  );
}
