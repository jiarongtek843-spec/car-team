import { useEffect } from "react";
import { DatePicker, Form, Input, InputNumber, message, Modal, Select } from "antd";
import dayjs from "dayjs";
import { useCreateMyCollectionMutation } from "../hooks";
import { useMyLegsQuery } from "../../driverJobs/hooks";
import { ringgitToCents } from "../../../lib/money";
import { PAYMENT_METHOD_LABELS, PURPOSE_LABELS } from "../types";
import type { CollectionPaymentMethod, CollectionPurpose } from "../types";

interface FormValues {
  legId: number;
  customerName?: string;
  purpose: CollectionPurpose;
  amount: number;
  paymentMethod: CollectionPaymentMethod;
  collectedAt: dayjs.Dayjs;
  remark?: string;
}

export function CreateCollectionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const { data: legs } = useMyLegsQuery();
  const createCollection = useCreateMyCollectionMutation();

  useEffect(() => {
    if (open) {
      form.setFieldsValue({ collectedAt: dayjs() });
    }
  }, [open, form]);

  function handleClose() {
    form.resetFields();
    onClose();
  }

  async function handleSubmit() {
    const values = await form.validateFields();
    const leg = legs?.find((l) => l.id === values.legId);
    if (!leg) return;

    await createCollection.mutateAsync({
      bookingId: leg.bookingId,
      legId: leg.id,
      customerName: values.customerName,
      purpose: values.purpose,
      amountCents: ringgitToCents(values.amount),
      paymentMethod: values.paymentMethod,
      collectedAt: values.collectedAt.toISOString(),
      remark: values.remark
    });

    message.success("Collection 已新增");
    handleClose();
  }

  return (
    <Modal
      title="新增 Collection"
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={createCollection.isPending}
      okText="建立"
      cancelText="取消"
    >
      <Form form={form} layout="vertical">
        <Form.Item name="legId" label="Booking / Leg" rules={[{ required: true, message: "请选择这笔代收款属于哪个 Booking" }]}>
          <Select
            placeholder="选择 Booking / Leg"
            options={legs?.map((leg) => ({
              label: `#${leg.bookingId} ${leg.booking.girlName} · Leg ${leg.sequence}`,
              value: leg.id
            }))}
          />
        </Form.Item>
        <Form.Item name="customerName" label="Customer">
          <Input placeholder="顾客名称（选填）" />
        </Form.Item>
        <Form.Item name="purpose" label="Purpose" rules={[{ required: true, message: "请选择 Purpose" }]}>
          <Select options={Object.entries(PURPOSE_LABELS).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        <Form.Item name="amount" label="Amount (RM)" rules={[{ required: true, message: "请输入金额" }]}>
          <InputNumber style={{ width: "100%" }} min={0.01} step={0.01} />
        </Form.Item>
        <Form.Item name="paymentMethod" label="Payment Method" rules={[{ required: true, message: "请选择 Payment Method" }]}>
          <Select options={Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        <Form.Item name="collectedAt" label="Collected Time" rules={[{ required: true, message: "请选择收款时间" }]}>
          <DatePicker showTime style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="remark" label="Remark">
          <Input.TextArea rows={2} placeholder="备注（选填）" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
