import { useState } from "react";
import { Button, Space, Table, Tag, Typography, Popconfirm, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useDriversQuery, useSetDriverStatusMutation } from "./hooks";
import { CreateDriverModal } from "./components/CreateDriverModal";
import { EditDriverModal } from "./components/EditDriverModal";
import { ResetPasswordModal } from "./components/ResetPasswordModal";
import type { Driver } from "../../types/booking";

export function DriverManagementPage() {
  const { data: drivers, isLoading } = useDriversQuery();
  const setStatus = useSetDriverStatusMutation();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [resettingDriver, setResettingDriver] = useState<Driver | null>(null);

  const columns: ColumnsType<Driver> = [
    { title: "编号", dataIndex: "id", width: 70 },
    { title: "Username", render: (_, d) => d.username ?? <Typography.Text type="secondary">无登入帐号</Typography.Text> },
    { title: "Full Name", dataIndex: "name" },
    { title: "Phone", dataIndex: "phone", render: (v) => v ?? "-" },
    { title: "Vehicle Plate", dataIndex: "vehiclePlateNumber", render: (v) => v ?? "-" },
    {
      title: "Status",
      dataIndex: "status",
      render: (status: Driver["status"]) => (
        <Tag color={status === "ACTIVE" ? "success" : "default"}>{status === "ACTIVE" ? "启用" : "停用"}</Tag>
      )
    },
    {
      title: "未完成 Leg",
      dataIndex: "hasActiveLeg",
      render: (v: boolean) => (v ? <Tag color="processing">有</Tag> : <Tag>无</Tag>)
    },
    {
      title: "操作",
      render: (_, driver) => (
        <Space>
          <a onClick={() => setEditingDriver(driver)}>编辑</a>
          {driver.username && <a onClick={() => setResettingDriver(driver)}>重设密码</a>}
          <Popconfirm
            title={driver.status === "ACTIVE" ? "确定要停用这位 Driver 吗？" : "确定要启用这位 Driver 吗？"}
            onConfirm={async () => {
              await setStatus.mutateAsync({
                id: driver.id,
                status: driver.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"
              });
              message.success("状态已更新");
            }}
          >
            <a style={{ color: driver.status === "ACTIVE" ? "#ff4d4f" : undefined }}>
              {driver.status === "ACTIVE" ? "停用" : "启用"}
            </a>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Driver Management
        </Typography.Title>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          + 新增 Driver
        </Button>
      </Space>

      <Table rowKey="id" loading={isLoading} dataSource={drivers} columns={columns} />

      <CreateDriverModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <EditDriverModal driver={editingDriver} onClose={() => setEditingDriver(null)} />
      <ResetPasswordModal driver={resettingDriver} onClose={() => setResettingDriver(null)} />
    </div>
  );
}
