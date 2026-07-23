import type { Key } from "react";
import { Card, Empty, Pagination, Skeleton, Space, Typography } from "antd";
import type { ColumnType } from "antd/es/table";

interface MobileCardListProps<T> {
  dataSource?: T[];
  columns: ColumnType<T>[];
  rowKey: string | ((record: T) => Key);
  loading?: boolean;
  onRowClick?: (record: T) => void;
  pagination?: false | { current: number; pageSize: number; total?: number; onChange: (page: number) => void };
  emptyText?: string;
}

function resolveRowKey<T>(record: T, rowKey: MobileCardListProps<T>["rowKey"], index: number): Key {
  if (typeof rowKey === "function") return rowKey(record);
  return ((record as Record<string, unknown>)[rowKey] as Key) ?? index;
}

/**
 * Mobile Phase 1：Table 在手机上一定会出现横向卷动（尤其 Wallet 那种 8~9 栏的表），
 * 改成一张 Card 一笔资料、栏位当成 label:value 直向列出。故意直接吃现有页面已经
 * 定义好的 `columns`（跟 antd Table 用的是同一份），每个页面只需要在手机时把
 * `<Table columns={columns} .../>` 换成 `<MobileCardList columns={columns} .../>`，
 * 不用为了手机另外重写一份栏位定义或 renderCard 函数。
 */
export function MobileCardList<T>({ dataSource, columns, rowKey, loading, onRowClick, pagination, emptyText }: MobileCardListProps<T>) {
  if (loading) {
    return (
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <Skeleton active />
        <Skeleton active />
        <Skeleton active />
      </Space>
    );
  }

  if (!dataSource || dataSource.length === 0) {
    return <Empty description={emptyText ?? "暂无数据"} />;
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      {dataSource.map((record, index) => (
        <Card
          key={resolveRowKey(record, rowKey, index)}
          size="small"
          hoverable={Boolean(onRowClick)}
          onClick={onRowClick ? () => onRowClick(record) : undefined}
          style={onRowClick ? { cursor: "pointer" } : undefined}
        >
          <Space direction="vertical" style={{ width: "100%" }} size={4}>
            {columns.map((column, columnIndex) => {
              const dataIndex = column.dataIndex as string | undefined;
              const raw = dataIndex ? (record as Record<string, unknown>)[dataIndex] : undefined;
              // column.render 的型别包含 RenderedCell（给 rowSpan/colSpan 合并儲存格用），
              // 这个专案目前没有任何栏位用到那个功能，只会回传单纯的 ReactNode。
              const content = (column.render ? column.render(raw, record, index) : raw) as React.ReactNode;
              if (content === undefined || content === null || content === "") return null;
              return (
                <div key={columnIndex} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <Typography.Text type="secondary" style={{ flexShrink: 0 }}>
                    {column.title as string}
                  </Typography.Text>
                  <div style={{ textAlign: "right", minWidth: 0 }}>{content}</div>
                </div>
              );
            })}
          </Space>
        </Card>
      ))}

      {pagination && pagination.total !== undefined && (
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
          <Pagination
            simple
            current={pagination.current}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onChange={pagination.onChange}
          />
        </div>
      )}
    </Space>
  );
}
