import { Checkbox, DatePicker, Form, Input, InputNumber, Select, Space, TimePicker, message } from "antd";
import type { Dayjs } from "dayjs";
import { useAddLegMutation } from "../hooks";
import { ringgitToCents } from "../../../lib/money";
import { ResponsiveModal } from "../../../common/ResponsiveModal";
import { LEG_TYPE_LABEL } from "./StatusTags";
import type { LegType } from "../../../types/booking";

interface FormValues {
  legType: LegType;
  pickupLocation?: string;
  dropoffLocation?: string;
  scheduledDate?: Dayjs;
  scheduledTime?: Dayjs;
  timeNotConfirmed?: boolean;
  notes?: string;
  earningAllocation?: number;
}

const LEG_TYPE_OPTIONS = (Object.keys(LEG_TYPE_LABEL) as LegType[]).map((value) => ({
  value,
  label: LEG_TYPE_LABEL[value]
}));

function combineScheduledAt(values: FormValues): string | null | undefined {
  if (values.timeNotConfirmed) return null;
  if (!values.scheduledDate) return undefined;
  const combined = values.scheduledTime
    ? values.scheduledDate.hour(values.scheduledTime.hour()).minute(values.scheduledTime.minute()).second(0).millisecond(0)
    : values.scheduledDate.hour(0).minute(0).second(0).millisecond(0);
  return combined.toISOString();
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
      legType: values.legType,
      pickupLocation: values.pickupLocation || undefined,
      dropoffLocation: values.dropoffLocation || undefined,
      scheduledAt: combineScheduledAt(values),
      notes: values.notes || undefined,
      earningAllocationCents: values.earningAllocation !== undefined ? ringgitToCents(values.earningAllocation) : undefined
    });
    message.success("Leg 新增成功");
    handleClose();
  }

  return (
    <ResponsiveModal
      title="新增 Leg"
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={addLeg.isPending}
      okText="新增"
      cancelText="取消"
    >
      <Form form={form} layout="vertical" initialValues={{ legType: "ADDITIONAL" }}>
        <Form.Item name="legType" label="行程类型">
          <Select options={LEG_TYPE_OPTIONS} />
        </Form.Item>
        <Form.Item name="pickupLocation" label="起点（可留空）">
          <Input />
        </Form.Item>
        <Form.Item name="dropoffLocation" label="终点（可留空）">
          <Input />
        </Form.Item>
        {/* 日期跟时间分开输入，才能清楚分开显示；「时间未定」让使用者明确表示这段行程
            的时间还没确定，不是忘记填——跟单纯留空效果相同（都会显示「待确认」），
            但意图更明确。 */}
        <Space wrap style={{ width: "100%" }} align="start">
          <Form.Item name="scheduledDate" label="日期">
            <DatePicker placeholder="选择日期" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="scheduledTime" label="时间">
            <TimePicker format="HH:mm" placeholder="选择时间" style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="timeNotConfirmed" valuePropName="checked" label=" ">
            <Checkbox>时间未定</Checkbox>
          </Form.Item>
        </Space>
        <Form.Item name="earningAllocation" label="司机收入 (RM)">
          <InputNumber style={{ width: "100%" }} min={0} step={0.01} />
        </Form.Item>
        <Form.Item name="notes" label="备注">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </ResponsiveModal>
  );
}
