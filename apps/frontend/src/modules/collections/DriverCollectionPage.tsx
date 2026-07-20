import { useState } from "react";
import { Button, Space, Typography, Upload, message } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { useMyCollectionsQuery, useUploadMyCollectionProofMutation } from "./hooks";
import { CreateCollectionModal } from "./components/CreateCollectionModal";
import { CollectionTable } from "./components/CollectionTable";
import type { Collection } from "./types";

const EDITABLE_STATUSES: Collection["status"][] = ["PENDING", "COLLECTED"];

export function DriverCollectionPage() {
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const pageSize = 20;

  const { data, isLoading } = useMyCollectionsQuery({ page, pageSize });
  const uploadProof = useUploadMyCollectionProofMutation();

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Collection（代收款）
        </Typography.Title>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          + 新增 Collection
        </Button>
      </Space>

      <CollectionTable
        data={data?.data}
        loading={isLoading}
        pagination={{ current: page, pageSize, total: data?.total ?? 0, onChange: setPage }}
        actions={(record) =>
          EDITABLE_STATUSES.includes(record.status) ? (
            <Upload
              showUploadList={false}
              beforeUpload={(file) => {
                uploadProof.mutate(
                  { id: record.id, file },
                  {
                    onSuccess: () => message.success("上传成功"),
                    onError: (err) => message.error(err instanceof Error ? err.message : "上传失败")
                  }
                );
                return false;
              }}
            >
              <Button size="small" icon={<UploadOutlined />}>
                上传证明
              </Button>
            </Upload>
          ) : null
        }
      />

      <CreateCollectionModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
