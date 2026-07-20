import { useState } from "react";
import { Card, Col, Row, Statistic, Typography } from "antd";
import { useMyTransactionsQuery, useMyWalletSummaryQuery } from "../wallet/hooks";
import { WalletTransactionTable } from "../wallet/components/WalletTransactionTable";
import { formatCents } from "../../lib/money";

export function MyEarningsPage() {
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data: summary } = useMyWalletSummaryQuery();
  const { data, isLoading } = useMyTransactionsQuery({ page, pageSize });

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4}>My Earnings</Typography.Title>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card>
            <Statistic title="Today Pending Earnings" value={formatCents(summary?.todayPendingCents)} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="Current Unsettled Earnings" value={formatCents(summary?.unsettledCents)} />
          </Card>
        </Col>
        <Col span={8}>
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
