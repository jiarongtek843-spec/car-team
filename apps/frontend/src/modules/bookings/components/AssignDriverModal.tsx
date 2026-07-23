import { useState } from "react";
import { Button, Divider, Form, Input, message, Select, Space } from "antd";
import { useDriversQuery, useCreateDriverMutation } from "../../drivers/hooks";
import { useAssignDriverMutation } from "../hooks";
import { ResponsiveModal } from "../../../common/ResponsiveModal";

interface Props {
  bookingId: number;
  legId: number | null;
  onClose: () => void;
}

export function AssignDriverModal({ bookingId, legId, onClose }: Props) {
  const [selectedDriverId, setSelectedDriverId] = useState<number | undefined>(undefined);
  const [newDriverName, setNewDriverName] = useState("");
  const [newDriverPhone, setNewDriverPhone] = useState("");

  const { data: drivers, isLoading } = useDriversQuery("ACTIVE");
  const createDriver = useCreateDriverMutation();
  const assignDriver = useAssignDriverMutation(bookingId);

  const open = legId !== null;

  function handleClose() {
    setSelectedDriverId(undefined);
    setNewDriverName("");
    setNewDriverPhone("");
    onClose();
  }

  async function handleAssign() {
    if (!legId || !selectedDriverId) {
      message.warning("请先选择司机");
      return;
    }
    await assignDriver.mutateAsync({ legId, driverId: selectedDriverId });
    message.success("指派成功");
    handleClose();
  }

  async function handleQuickAdd() {
    if (!newDriverName.trim()) {
      message.warning("请输入司机姓名");
      return;
    }
    const driver = await createDriver.mutateAsync({
      name: newDriverName.trim(),
      phone: newDriverPhone.trim() || undefined
    });
    setSelectedDriverId(driver.id);
    setNewDriverName("");
    setNewDriverPhone("");
    message.success("司机新增成功，已选中");
  }

  return (
    <ResponsiveModal
      title="指派司机"
      open={open}
      onCancel={handleClose}
      onOk={handleAssign}
      confirmLoading={assignDriver.isPending}
      okText="指派"
      cancelText="取消"
    >
      <Form layout="vertical">
        <Form.Item label="选择司机">
          <Select
            loading={isLoading}
            placeholder="选择现有司机"
            value={selectedDriverId}
            onChange={setSelectedDriverId}
            options={drivers?.map((driver) => ({
              label: driver.phone ? `${driver.name}（${driver.phone}）` : driver.name,
              value: driver.id
            }))}
          />
        </Form.Item>

        <Divider plain>或快速新增司机</Divider>

        <Space.Compact style={{ width: "100%" }}>
          <Input placeholder="司机姓名" value={newDriverName} onChange={(e) => setNewDriverName(e.target.value)} />
          <Input placeholder="电话（可选）" value={newDriverPhone} onChange={(e) => setNewDriverPhone(e.target.value)} />
          <Button onClick={handleQuickAdd} loading={createDriver.isPending}>
            新增
          </Button>
        </Space.Compact>
      </Form>
    </ResponsiveModal>
  );
}
