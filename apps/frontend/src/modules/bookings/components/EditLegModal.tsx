import { useEffect, useRef } from "react";
import { Checkbox, DatePicker, Form, Input, InputNumber, Space, TimePicker, message } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { useUpdateLegMutation } from "../hooks";
import { calculateEstimatedFinish } from "../../../lib/schedule";
import type { Leg } from "../../../types/booking";
import { ResponsiveModal } from "../../../common/ResponsiveModal";

interface FormValues {
  pickupLocation?: string;
  dropoffLocation?: string;
  scheduledDate?: Dayjs;
  scheduledTime?: Dayjs;
  timeNotConfirmed?: boolean;
  estimatedDurationMinutes?: number;
  estimatedFinishDate?: Dayjs;
  estimatedFinishTime?: Dayjs;
}

function combineDateTime(date: Dayjs | undefined, time: Dayjs | undefined): Dayjs | undefined {
  if (!date) return undefined;
  return time ? date.hour(time.hour()).minute(time.minute()).second(0).millisecond(0) : date.hour(0).minute(0).second(0).millisecond(0);
}

function combineScheduledAt(values: FormValues): string | null | undefined {
  if (values.timeNotConfirmed) return null;
  const combined = combineDateTime(values.scheduledDate, values.scheduledTime);
  return combined ? combined.toISOString() : undefined;
}

function combineEstimatedFinishAt(values: FormValues): string | null | undefined {
  const combined = combineDateTime(values.estimatedFinishDate, values.estimatedFinishTime);
  return combined ? combined.toISOString() : undefined;
}

/**
 * Mobile UAT Round 2：这个 Modal 之前叫「设定收入」，只能改 Driver Income——现在
 * Driver Income 自动依 Driver Pool 平分，不该在这里手动输入。改成「Edit Leg」，
 * 编辑 Pickup Location/Destination/Pickup Date/Time/Estimated Duration/Finish Time。
 */
export function EditLegModal({ bookingId, leg, onClose }: { bookingId: number; leg: Leg | null; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const updateLeg = useUpdateLegMutation(bookingId);
  const open = leg !== null;
  const manualFinish = useRef(false);

  useEffect(() => {
    if (leg) {
      manualFinish.current = false;
      form.setFieldsValue({
        pickupLocation: leg.pickupLocation ?? undefined,
        dropoffLocation: leg.dropoffLocation ?? undefined,
        scheduledDate: leg.scheduledAt ? dayjs(leg.scheduledAt) : undefined,
        scheduledTime: leg.scheduledAt ? dayjs(leg.scheduledAt) : undefined,
        estimatedDurationMinutes: leg.estimatedDurationMinutes ?? undefined,
        estimatedFinishDate: leg.estimatedFinishAt ? dayjs(leg.estimatedFinishAt) : undefined,
        estimatedFinishTime: leg.estimatedFinishAt ? dayjs(leg.estimatedFinishAt) : undefined
      });
    }
  }, [leg, form]);

  function handleClose() {
    form.resetFields();
    onClose();
  }

  function handleValuesChange(changedValues: Partial<FormValues>, allValues: FormValues) {
    if ("estimatedFinishDate" in changedValues || "estimatedFinishTime" in changedValues) {
      manualFinish.current = true;
      return;
    }
    const touchesRelevantField =
      "scheduledDate" in changedValues || "scheduledTime" in changedValues || "estimatedDurationMinutes" in changedValues;
    if (!touchesRelevantField || manualFinish.current) return;

    const scheduledAt = combineDateTime(allValues.scheduledDate, allValues.scheduledTime);
    const finish = calculateEstimatedFinish(scheduledAt, allValues.estimatedDurationMinutes);
    form.setFields([
      { name: "estimatedFinishDate", value: finish },
      { name: "estimatedFinishTime", value: finish }
    ]);
  }

  async function handleSubmit() {
    if (!leg) return;
    const values = await form.validateFields();
    await updateLeg.mutateAsync({
      legId: leg.id,
      input: {
        pickupLocation: values.pickupLocation || undefined,
        dropoffLocation: values.dropoffLocation || undefined,
        scheduledAt: combineScheduledAt(values),
        estimatedDurationMinutes: values.estimatedDurationMinutes,
        estimatedFinishAt: combineEstimatedFinishAt(values)
      }
    });
    message.success("Leg 已更新");
    handleClose();
  }

  return (
    <ResponsiveModal
      title={`Edit Leg${leg ? ` — Leg ${leg.sequence}` : ""}`}
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={updateLeg.isPending}
      okText="储存"
      cancelText="取消"
    >
      <Form form={form} layout="vertical" onValuesChange={handleValuesChange}>
        <Form.Item name="pickupLocation" label="Pickup Location（可留空）">
          <Input />
        </Form.Item>
        <Form.Item name="dropoffLocation" label="Destination（可留空）">
          <Input />
        </Form.Item>
        <Space wrap style={{ width: "100%" }} align="start">
          <Form.Item name="scheduledDate" label="Pickup Date">
            <DatePicker placeholder="选择日期" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="scheduledTime" label="Pickup Time">
            <TimePicker format="HH:mm" placeholder="选择时间" style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="timeNotConfirmed" valuePropName="checked" label=" ">
            <Checkbox>时间未定</Checkbox>
          </Form.Item>
        </Space>
        <Space wrap style={{ width: "100%" }} align="start">
          <Form.Item name="estimatedDurationMinutes" label="Estimated Duration (分钟)">
            <InputNumber placeholder="可留空" min={1} step={1} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="estimatedFinishDate" label="Estimated Finish Date">
            <DatePicker placeholder="自动算好，可手动改" style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="estimatedFinishTime" label="Estimated Finish Time">
            <TimePicker format="HH:mm" placeholder="自动算好，可手动改" style={{ width: 120 }} />
          </Form.Item>
        </Space>
      </Form>
    </ResponsiveModal>
  );
}
