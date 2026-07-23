import { useEffect } from "react";
import { Form, InputNumber, message } from "antd";
import { useUpdateLegMutation } from "../hooks";
import { centsToRinggit, ringgitToCents } from "../../../lib/money";
import type { Leg } from "../../../types/booking";
import { ResponsiveModal } from "../../../common/ResponsiveModal";

interface FormValues {
  earningAllocation?: number;
}

export function EditAllocationModal({
  bookingId,
  leg,
  onClose
}: {
  bookingId: number;
  leg: Leg | null;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const updateLeg = useUpdateLegMutation(bookingId);
  const open = leg !== null;

  useEffect(() => {
    if (leg) {
      form.setFieldsValue({ earningAllocation: centsToRinggit(leg.earningAllocationCents) });
    }
  }, [leg, form]);

  function handleClose() {
    form.resetFields();
    onClose();
  }

  async function handleSubmit() {
    if (!leg) return;
    const values = await form.validateFields();
    await updateLeg.mutateAsync({
      legId: leg.id,
      input: { earningAllocationCents: ringgitToCents(values.earningAllocation ?? 0) }
    });
    message.success("Leg 收入分配已更新");
    handleClose();
  }

  return (
    <ResponsiveModal
      title={`设定司机收入${leg ? ` — Leg ${leg.sequence}` : ""}`}
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={updateLeg.isPending}
      okText="储存"
      cancelText="取消"
    >
      <Form form={form} layout="vertical">
        <Form.Item name="earningAllocation" label="司机收入 (RM)" rules={[{ required: true, message: "请输入金额" }]}>
          <InputNumber style={{ width: "100%" }} min={0} step={0.01} />
        </Form.Item>
      </Form>
    </ResponsiveModal>
  );
}
