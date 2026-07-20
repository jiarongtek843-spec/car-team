import { useState } from "react";
import { Input, Select, Space, Typography } from "antd";
import { useAdminCollectionsQuery, useVerifyCollectionMutation } from "./hooks";
import { useDriversQuery } from "../drivers/hooks";
import { CollectionTable } from "./components/CollectionTable";
import { VoidCollectionModal } from "./components/VoidCollectionModal";
import { PAYMENT_METHOD_LABELS, PURPOSE_LABELS, STATUS_LABELS } from "./types";
import type { Collection, CollectionPaymentMethod, CollectionPurpose, CollectionStatus } from "./types";

export function AdminCollectionPage() {
  const [driverId, setDriverId] = useState<number | undefined>(undefined);
  const [status, setStatus] = useState<CollectionStatus | undefined>(undefined);
  const [paymentMethod, setPaymentMethod] = useState<CollectionPaymentMethod | undefined>(undefined);
  const [purpose, setPurpose] = useState<CollectionPurpose | undefined>(undefined);
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState(1);
  const [voidingId, setVoidingId] = useState<number | null>(null);
  const pageSize = 20;

  const { data: drivers } = useDriversQuery();
  const { data, isLoading } = useAdminCollectionsQuery({
    driverId,
    status,
    paymentMethod,
    purpose,
    search: search || undefined,
    page,
    pageSize
  });
  const verifyCollection = useVerifyCollectionMutation();

  function resetPageAnd<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4}>Collection（代收款）</Typography.Title>

      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          placeholder="筛选 Driver"
          style={{ width: 160 }}
          options={drivers?.map((driver) => ({ label: driver.name, value: driver.id }))}
          value={driverId}
          onChange={resetPageAnd(setDriverId)}
        />
        <Select
          allowClear
          placeholder="筛选状态"
          style={{ width: 140 }}
          options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          value={status}
          onChange={resetPageAnd(setStatus)}
        />
        <Select
          allowClear
          placeholder="筛选 Payment Method"
          style={{ width: 180 }}
          options={Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }))}
          value={paymentMethod}
          onChange={resetPageAnd(setPaymentMethod)}
        />
        <Select
          allowClear
          placeholder="筛选 Purpose"
          style={{ width: 160 }}
          options={Object.entries(PURPOSE_LABELS).map(([value, label]) => ({ value, label }))}
          value={purpose}
          onChange={resetPageAnd(setPurpose)}
        />
        <Input.Search
          allowClear
          placeholder="搜索 Customer / Remark"
          style={{ width: 220 }}
          onSearch={resetPageAnd(setSearch)}
        />
      </Space>

      <CollectionTable
        data={data?.data}
        loading={isLoading}
        showDriverColumn
        pagination={{ current: page, pageSize, total: data?.total ?? 0, onChange: setPage }}
        actions={(record: Collection) => (
          <Space>
            {record.status === "COLLECTED" && (
              <a onClick={() => verifyCollection.mutate(record.id)}>Verify</a>
            )}
            {(record.status === "PENDING" || record.status === "COLLECTED" || record.status === "VERIFIED") && (
              <a onClick={() => setVoidingId(record.id)}>Void</a>
            )}
          </Space>
        )}
      />

      <VoidCollectionModal collectionId={voidingId} onClose={() => setVoidingId(null)} />
    </div>
  );
}
