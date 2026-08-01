import { useState } from "react";
import { Card, DatePicker, Space, Statistic, Typography } from "antd";
import dayjs from "dayjs";
import { useCollectionSummaryQuery, useCompanyCommissionSummaryQuery } from "./hooks";
import { useCompanySettingsQuery } from "../companySettings/hooks";
import { formatCents } from "../../lib/money";
import { useIsMobile } from "../../common/useIsMobile";

/**
 * 老板/记帐用的总览页面——只显示两个总数（公司抽成、Collection 代收），不涉及派单/司机
 * 资料，专门给 FINANCE 角色（以及 OWNER/MANAGER 想快速看总数时）用。预设「全部时间」，
 * 可以自己选日期区间重新计算。
 */
export function OverviewPage() {
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const isMobile = useIsMobile();

  const filters = {
    dateFrom: dateRange?.[0]?.format("YYYY-MM-DD"),
    dateTo: dateRange?.[1]?.format("YYYY-MM-DD")
  };

  const { data: settings } = useCompanySettingsQuery();
  const { data: commission, isLoading: commissionLoading } = useCompanyCommissionSummaryQuery(filters);
  const { data: collection, isLoading: collectionLoading } = useCollectionSummaryQuery(filters);

  const commissionRateLabel =
    settings && settings.companyCommissionType === "PERCENTAGE"
      ? `抽成比例 ${settings.companyCommissionValue}%`
      : settings
        ? `固定抽成 ${formatCents(settings.companyCommissionValue)}`
        : undefined;

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      <Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          总览
        </Typography.Title>
        <DatePicker.RangePicker
          value={dateRange}
          placeholder={["开始日期（不选=全部时间）", "结束日期"]}
          style={{ width: isMobile ? "100%" : undefined }}
          onChange={(range) => setDateRange(range as [dayjs.Dayjs, dayjs.Dayjs] | null)}
        />
      </Space>

      <Space direction={isMobile ? "vertical" : "horizontal"} size={16} style={{ width: "100%" }}>
        <Card style={{ flex: 1, minWidth: isMobile ? "100%" : 280 }} loading={commissionLoading}>
          <Statistic
            title={commissionRateLabel ? `公司抽成总数（${commissionRateLabel}）` : "公司抽成总数"}
            value={formatCents(commission?.companyCommissionCents)}
          />
          <Typography.Text type="secondary">共 {commission?.bookingCount ?? 0} 张 Booking</Typography.Text>
        </Card>

        <Card style={{ flex: 1, minWidth: isMobile ? "100%" : 280 }} loading={collectionLoading}>
          <Statistic title="Collection 代收总数" value={formatCents(collection?.totalAmountCents)} />
          <Typography.Text type="secondary">共 {collection?.count ?? 0} 笔（只算已验证）</Typography.Text>
        </Card>
      </Space>
    </div>
  );
}
