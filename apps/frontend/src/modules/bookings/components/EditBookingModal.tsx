import { useEffect } from "react";
import { Form, Input, InputNumber, message, Modal, Select, Space } from "antd";
import { useUpdateBookingMutation } from "../hooks";
import { centsToRinggit, ringgitToCents } from "../../../lib/money";
import type { Booking, CommissionType } from "../../../types/booking";

interface FormValues {
  girlName: string;
  notes?: string;
  totalAmount?: number;
  commissionType?: CommissionType;
  commissionValue?: number;
}

const COMMISSION_TYPE_OPTIONS = [
  { label: "Percentage (%)", value: "PERCENTAGE" },
  { label: "Fixed Amount (RM)", value: "FIXED_AMOUNT" }
];

export function EditBookingModal({ booking, open, onClose }: { booking: Booking; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const updateBooking = useUpdateBookingMutation(booking.id);

  const hasEarningHistory = booking.legs.some((leg) => leg.status === "COMPLETED");

  useEffect(() => {
    if (open) {
      form.setFieldsValue({
        girlName: booking.girlName,
        notes: booking.notes ?? undefined,
        totalAmount: centsToRinggit(booking.totalAmountCents),
        commissionType: booking.platformCommissionType,
        commissionValue:
          booking.platformCommissionType === "FIXED_AMOUNT"
            ? centsToRinggit(booking.platformCommissionValue)
            : booking.platformCommissionValue
      });
    }
  }, [open, booking, form]);

  function handleClose() {
    onClose();
  }

  async function handleSubmit() {
    const values = await form.validateFields();
    await updateBooking.mutateAsync({
      girlName: values.girlName,
      notes: values.notes || undefined,
      totalAmountCents: hasEarningHistory ? undefined : ringgitToCents(values.totalAmount ?? 0),
      commissionType: hasEarningHistory ? undefined : values.commissionType,
      commissionValue: hasEarningHistory
        ? undefined
        : values.commissionType === "FIXED_AMOUNT"
          ? ringgitToCents(values.commissionValue ?? 0)
          : values.commissionValue
    });
    message.success("Booking 已更新");
    handleClose();
  }

  return (
    <Modal
      title="编辑 Booking"
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={updateBooking.isPending}
      okText="储存"
      cancelText="取消"
    >
      <Form form={form} layout="vertical">
        <Form.Item name="girlName" label="Girl 姓名" rules={[{ required: true, message: "请输入 Girl 姓名" }]}>
          <Input />
        </Form.Item>
        <Form.Item name="notes" label="备注">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item
          name="totalAmount"
          label="Booking Total (RM)"
          extra={hasEarningHistory ? "已有完成的 Leg，总价与抽成不能再修改" : undefined}
        >
          <InputNumber style={{ width: "100%" }} min={0} step={0.01} disabled={hasEarningHistory} />
        </Form.Item>
        <Space>
          <Form.Item name="commissionType" label="Commission Type" style={{ marginBottom: 0 }}>
            <Select style={{ width: 180 }} options={COMMISSION_TYPE_OPTIONS} disabled={hasEarningHistory} />
          </Form.Item>
          <Form.Item name="commissionValue" label="Commission Value" style={{ marginBottom: 0 }}>
            <InputNumber min={0} step={0.01} disabled={hasEarningHistory} />
          </Form.Item>
        </Space>
      </Form>
    </Modal>
  );
}
