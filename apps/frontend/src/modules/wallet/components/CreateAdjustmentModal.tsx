import { useEffect } from "react";
import { DatePicker, Form, Input, InputNumber, message, Radio, Select } from "antd";
import dayjs from "dayjs";
import { useCreateManualAdjustmentMutation, useCreateSettlementAdjustmentMutation } from "../hooks";
import { useDriversQuery } from "../../drivers/hooks";
import { ringgitToCents } from "../../../lib/money";
import { ResponsiveModal } from "../../../common/ResponsiveModal";

interface FormValues {
  driverId: number;
  sign: "POSITIVE" | "NEGATIVE";
  amount: number;
  reason: string;
  effectiveDate: dayjs.Dayjs;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 默认 MANUAL_ADJUSTMENT；从 Settlement History 开的时候传 SETTLEMENT_ADJUSTMENT。 */
  type?: "MANUAL_ADJUSTMENT" | "SETTLEMENT_ADJUSTMENT";
  relatedSettlementId?: number;
  defaultDriverId?: number;
}

export function CreateAdjustmentModal({
  open,
  onClose,
  type = "MANUAL_ADJUSTMENT",
  relatedSettlementId,
  defaultDriverId
}: Props) {
  const [form] = Form.useForm<FormValues>();
  const { data: drivers } = useDriversQuery();
  const createManualAdjustment = useCreateManualAdjustmentMutation();
  const createSettlementAdjustment = useCreateSettlementAdjustmentMutation();
  const isSettlementAdjustment = type === "SETTLEMENT_ADJUSTMENT";
  const pending = isSettlementAdjustment ? createSettlementAdjustment.isPending : createManualAdjustment.isPending;

  useEffect(() => {
    if (open) {
      form.setFieldsValue({ sign: "POSITIVE", effectiveDate: dayjs(), driverId: defaultDriverId });
    }
  }, [open, defaultDriverId, form]);

  function handleClose() {
    form.resetFields();
    onClose();
  }

  async function handleSubmit() {
    const values = await form.validateFields();
    const magnitude = ringgitToCents(values.amount);
    const amountCents = values.sign === "NEGATIVE" ? -magnitude : magnitude;

    if (isSettlementAdjustment) {
      await createSettlementAdjustment.mutateAsync({
        driverId: values.driverId,
        amountCents,
        reason: values.reason,
        effectiveDate: values.effectiveDate.toISOString(),
        relatedSettlementId
      });
    } else {
      await createManualAdjustment.mutateAsync({
        driverId: values.driverId,
        amountCents,
        reason: values.reason,
        effectiveDate: values.effectiveDate.toISOString()
      });
    }

    message.success("Adjustment 已建立");
    handleClose();
  }

  return (
    <ResponsiveModal
      title={isSettlementAdjustment ? "新增 Settlement Adjustment" : "新增 Manual Adjustment"}
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={pending}
      okText="建立"
      cancelText="取消"
    >
      <Form form={form} layout="vertical">
        <Form.Item name="driverId" label="Driver" rules={[{ required: true, message: "请选择 Driver" }]}>
          <Select
            disabled={defaultDriverId !== undefined}
            options={drivers?.map((driver) => ({ label: driver.name, value: driver.id }))}
            placeholder="选择 Driver"
          />
        </Form.Item>
        <Form.Item name="sign" label="Positive 或 Negative" rules={[{ required: true }]}>
          <Radio.Group>
            <Radio value="POSITIVE">Positive（增加）</Radio>
            <Radio value="NEGATIVE">Negative（扣除）</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="amount" label="Amount (RM)" rules={[{ required: true, message: "请输入金额" }]}>
          <InputNumber style={{ width: "100%" }} min={0.01} step={0.01} />
        </Form.Item>
        <Form.Item name="reason" label="Reason" rules={[{ required: true, message: "请填写原因" }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="effectiveDate" label="Effective Date" rules={[{ required: true, message: "请选择日期" }]}>
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </ResponsiveModal>
  );
}
