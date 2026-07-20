import { DatePicker, Form, Input, InputNumber, message, Modal } from "antd";
import type { Dayjs } from "dayjs";
import { useAddLegMutation } from "../hooks";
import { ringgitToCents } from "../../../lib/money";

interface FormValues {
  pickupLocation?: string;
  dropoffLocation?: string;
  scheduledAt?: Dayjs;
  notes?: string;
  earningAllocation?: number;
}

export function AddLegModal({ bookingId, open, onClose }: { bookingId: number; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const addLeg = useAddLegMutation(bookingId);

  function handleClose() {
    form.resetFields();
    onClose();
  }

  async function handleSubmit() {
    const values = await form.validateFields();
    await addLeg.mutateAsync({
      pickupLocation: values.pickupLocation || undefined,
      dropoffLocation: values.dropoffLocation || undefined,
      scheduledAt: values.scheduledAt?.toISOString(),
      notes: values.notes || undefined,
      earningAllocationCents: values.earningAllocation !== undefined ? ringgitToCents(values.earningAllocation) : undefined
    });
    message.success("Leg 新增成功");
    handleClose();
  }

  return (
    <Modal
      title="新增 Leg"
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={addLeg.isPending}
      okText="新增"
      cancelText="取消"
    >
      <Form form={form} layout="vertical">
        <Form.Item name="pickupLocation" label="起点（可留空）">
          <Input />
        </Form.Item>
        <Form.Item name="dropoffLocation" label="终点（可留空）">
          <Input />
        </Form.Item>
        <Form.Item name="scheduledAt" label="预定时间">
          <DatePicker showTime style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="earningAllocation" label="司机收入 (RM)">
          <InputNumber style={{ width: "100%" }} min={0} step={0.01} />
        </Form.Item>
        <Form.Item name="notes" label="备注">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
