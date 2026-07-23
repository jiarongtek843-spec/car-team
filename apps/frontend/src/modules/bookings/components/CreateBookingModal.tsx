import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Collapse, DatePicker, Divider, Form, Input, InputNumber, message, Select, Space, Typography } from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { useCreateBookingMutation } from "../hooks";
import { parseBookingText } from "../parseBookingText";
import { ringgitToCents } from "../../../lib/money";
import type { CommissionType, CreateBookingInput } from "../../../types/booking";
import type { Dayjs } from "dayjs";
import { ResponsiveModal } from "../../../common/ResponsiveModal";
import { ApiError } from "../../../api/http";

interface FormLeg {
  pickupLocation?: string;
  dropoffLocation?: string;
  scheduledAt?: Dayjs;
  earningAllocation?: number;
}

interface FormValues {
  girlName: string;
  totalAmount?: number;
  commissionType?: CommissionType;
  commissionValue?: number;
  notes?: string;
  legs?: FormLeg[];
}

const COMMISSION_TYPE_OPTIONS = [
  { label: "Percentage (%)", value: "PERCENTAGE" },
  { label: "Fixed Amount (RM)", value: "FIXED_AMOUNT" }
];

export function CreateBookingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const [pasteText, setPasteText] = useState("");
  const navigate = useNavigate();
  const createBooking = useCreateBookingMutation();

  function handleClose() {
    form.resetFields();
    setPasteText("");
    onClose();
  }

  function handleParse() {
    if (!pasteText.trim()) {
      message.warning("请先贴上派单文字");
      return;
    }

    const parsed = parseBookingText(pasteText);
    if (!parsed.girlName && !parsed.legs) {
      message.warning("没有识别到任何内容，请检查格式或手动填写");
      return;
    }

    form.setFieldsValue({
      girlName: parsed.girlName,
      totalAmount: parsed.totalAmountCents !== undefined ? parsed.totalAmountCents / 100 : undefined,
      notes: parsed.notes,
      legs: parsed.legs?.map((leg) => ({
        pickupLocation: leg.pickupLocation,
        dropoffLocation: leg.dropoffLocation,
        scheduledAt: leg.scheduledAt
      }))
    });
    message.success("已识别，请核对下方内容");
  }

  async function handleSubmit() {
    // Mobile First UI Remediation：原本 validateFields()/mutateAsync() 都没有 catch——
    // Validation 失败时 antd Form 本身会显示栏位错误（这部分行为不受影响），但会留下
    // 一个没人处理的 rejected Promise；mutateAsync 失败时更严重，使用者会看到「没反应」，
    // 没有任何错误讯息。统一包一层：Validation 失败就什么都不做（antd 已经显示了），
    // API 失败才跳错误讯息。
    try {
      const values = await form.validateFields();
      const input: CreateBookingInput = {
        girlName: values.girlName,
        notes: values.notes || undefined,
        totalAmountCents: values.totalAmount !== undefined ? ringgitToCents(values.totalAmount) : undefined,
        commissionType: values.commissionType,
        commissionValue:
          values.commissionValue !== undefined
            ? values.commissionType === "FIXED_AMOUNT"
              ? ringgitToCents(values.commissionValue)
              : values.commissionValue
            : undefined,
        legs: values.legs?.map((leg) => ({
          pickupLocation: leg.pickupLocation || undefined,
          dropoffLocation: leg.dropoffLocation || undefined,
          scheduledAt: leg.scheduledAt?.toISOString(),
          earningAllocationCents: leg.earningAllocation !== undefined ? ringgitToCents(leg.earningAllocation) : undefined
        }))
      };

      const booking = await createBooking.mutateAsync(input);
      message.success(`Booking #${booking.id} 建立成功`);
      handleClose();
      navigate(`/bookings/${booking.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        message.error(err.message);
      }
    }
  }

  return (
    <ResponsiveModal
      title="新建 Booking"
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={createBooking.isPending}
      okText="建立"
      cancelText="取消"
      width={680}
    >
      <Typography.Text strong>智能识别</Typography.Text>
      <Input.TextArea
        rows={6}
        placeholder={"贴上派单文字，例如：\nDate: 20/7\nGirl: Yoyo\nPick up: 8.45pm\nTime: 9 hrs\nCollect: 1060\nAddress:\n====================\nAera Service Residency Apartment\n====================\nCar fee: 130"}
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        style={{ marginTop: 8, marginBottom: 8 }}
      />
      <Button onClick={handleParse}>识别并填入</Button>

      <Divider />

      <Form form={form} layout="vertical">
        <Form.Item name="girlName" label="Girl 姓名" rules={[{ required: true, message: "请输入 Girl 姓名" }]}>
          <Input />
        </Form.Item>
        <Form.Item name="totalAmount" label="Booking Total (RM)">
          <InputNumber style={{ width: "100%" }} min={0} step={0.01} />
        </Form.Item>
        <Form.Item name="notes" label="备注">
          <Input.TextArea rows={2} />
        </Form.Item>

        <Collapse
          ghost
          items={[
            {
              key: "commission",
              label: "抽成设定（不填就用公司默认值）",
              children: (
                <Space wrap>
                  <Form.Item name="commissionType" label="Commission Type" style={{ marginBottom: 0 }}>
                    <Select style={{ width: 180 }} allowClear options={COMMISSION_TYPE_OPTIONS} />
                  </Form.Item>
                  <Form.Item name="commissionValue" label="Commission Value" style={{ marginBottom: 0 }}>
                    <InputNumber min={0} step={0.01} />
                  </Form.Item>
                </Space>
              )
            }
          ]}
        />

        <Form.List name="legs">
          {(fields, { add, remove }) => (
            <>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>行程 Leg（可选，之后也能再加）</div>
              {fields.map(({ key, name, ...rest }) => (
                <Space key={key} align="baseline" style={{ display: "flex", marginBottom: 8 }} wrap>
                  <Form.Item {...rest} name={[name, "pickupLocation"]}>
                    <Input placeholder="起点（可留空）" style={{ width: 140 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "dropoffLocation"]}>
                    <Input placeholder="终点（可留空）" style={{ width: 140 }} />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "scheduledAt"]}>
                    <DatePicker showTime placeholder="预定时间" />
                  </Form.Item>
                  <Form.Item {...rest} name={[name, "earningAllocation"]}>
                    <InputNumber placeholder="司机收入 (RM)" min={0} step={0.01} style={{ width: 140 }} />
                  </Form.Item>
                  <MinusCircleOutlined onClick={() => remove(name)} />
                </Space>
              ))}
              <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />}>
                新增 Leg
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </ResponsiveModal>
  );
}
