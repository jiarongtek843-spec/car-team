import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  Checkbox,
  Collapse,
  DatePicker,
  Divider,
  Form,
  Input,
  InputNumber,
  message,
  Select,
  Space,
  TimePicker,
  Typography
} from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { useCreateBookingMutation } from "../hooks";
import { parseBookingText } from "../parseBookingText";
import { ringgitToCents } from "../../../lib/money";
import { calculateEstimatedFinish } from "../../../lib/schedule";
import type { CommissionType, CreateBookingInput } from "../../../types/booking";
import type { LegType } from "../../../types/booking";
import type { Dayjs } from "dayjs";
import { ResponsiveModal } from "../../../common/ResponsiveModal";
import { ApiError } from "../../../api/http";
import { LEG_TYPE_LABEL } from "./StatusTags";

interface FormLeg {
  legType: LegType;
  pickupLocation?: string;
  dropoffLocation?: string;
  // 日期跟时间刻意拆成两个独立栏位输入，才能满足「Scheduled Date 和 Scheduled Time
  // 必须清楚分开显示」；送出时合并回同一个 scheduledAt（安全复用既有栏位，不新增
  // 会跟它冲突的栏位）。Estimated Finish 也是同一套拆法。
  scheduledDate?: Dayjs;
  scheduledTime?: Dayjs;
  timeNotConfirmed?: boolean;
  estimatedDurationMinutes?: number;
  estimatedFinishDate?: Dayjs;
  estimatedFinishTime?: Dayjs;
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

const LEG_TYPE_OPTIONS = (Object.keys(LEG_TYPE_LABEL) as LegType[]).map((value) => ({
  value,
  label: LEG_TYPE_LABEL[value]
}));

// 新建 Booking 预设直接给去程 + 回程两个 Leg——这是核心业务资料（几点载去、几点载回），
// 不该让使用者手动想到要自己加。之后仍然可以用「+ 新增行程」加第三个 ADDITIONAL Leg，
// 也可以把预设的两个都删掉（例如这张 Booking 目前还不知道任何行程细节）。
// Mobile UAT Round 2：去程起点 / 回程终点默认都是公司基地「28」，符合实际业务流程——
// 大多数行程都是从 28 出发、最后回到 28，中间才是客人真正的地址。
function defaultLegs(): FormLeg[] {
  return [
    { legType: "OUTBOUND", pickupLocation: "28" },
    { legType: "RETURN", dropoffLocation: "28" }
  ];
}

function combineDateTime(date: Dayjs | undefined, time: Dayjs | undefined): Dayjs | undefined {
  if (!date) return undefined;
  return time ? date.hour(time.hour()).minute(time.minute()).second(0).millisecond(0) : date.hour(0).minute(0).second(0).millisecond(0);
}

function combineScheduledAt(leg: FormLeg): string | null | undefined {
  if (leg.timeNotConfirmed) return null;
  const combined = combineDateTime(leg.scheduledDate, leg.scheduledTime);
  return combined ? combined.toISOString() : undefined;
}

function combineEstimatedFinishAt(leg: FormLeg): string | null | undefined {
  const combined = combineDateTime(leg.estimatedFinishDate, leg.estimatedFinishTime);
  return combined ? combined.toISOString() : undefined;
}

export function CreateBookingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const [pasteText, setPasteText] = useState("");
  const navigate = useNavigate();
  const createBooking = useCreateBookingMutation();
  // Mobile UAT Round 2：Estimated Finish Time 预设自动算（Pickup Time + Duration），
  // 但使用者直接编辑过某一个 Leg 的 Finish Time 之后，那笔就不该再被自动算的结果覆盖回去——
  // 跟 Leg 本身「自动/手动」的精神一致。用 index 记录哪些 Leg 已经被手动改过。
  const manualFinishLegIndexes = useRef<Set<number>>(new Set());

  function handleClose() {
    form.resetFields();
    setPasteText("");
    manualFinishLegIndexes.current.clear();
    onClose();
  }

  function handleValuesChange(changedValues: Partial<FormValues>, allValues: FormValues) {
    const changedLegs = changedValues.legs;
    if (!changedLegs) return;

    changedLegs.forEach((changedLeg, index) => {
      if (!changedLeg) return;

      if ("estimatedFinishDate" in changedLeg || "estimatedFinishTime" in changedLeg) {
        manualFinishLegIndexes.current.add(index);
        return;
      }

      const touchesRelevantField =
        "scheduledDate" in changedLeg || "scheduledTime" in changedLeg || "estimatedDurationMinutes" in changedLeg;
      if (!touchesRelevantField || manualFinishLegIndexes.current.has(index)) return;

      const leg = allValues.legs?.[index];
      if (!leg) return;
      const scheduledAt = combineDateTime(leg.scheduledDate, leg.scheduledTime);
      const finish = calculateEstimatedFinish(scheduledAt, leg.estimatedDurationMinutes);
      form.setFields([
        { name: ["legs", index, "estimatedFinishDate"], value: finish },
        { name: ["legs", index, "estimatedFinishTime"], value: finish }
      ]);
    });
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

    manualFinishLegIndexes.current.clear();

    form.setFieldsValue({
      girlName: parsed.girlName,
      totalAmount: parsed.totalAmountCents !== undefined ? parsed.totalAmountCents / 100 : undefined,
      notes: parsed.notes,
      legs: parsed.legs?.map((leg, index) => {
        const legType: LegType = index === 0 ? "OUTBOUND" : index === 1 ? "RETURN" : "ADDITIONAL";
        const finish = calculateEstimatedFinish(leg.scheduledAt, leg.estimatedDurationMinutes);
        return {
          legType,
          // 识别到地址就覆盖默认值；没识别到就保留「28」这个基地默认值，不要被清空。
          pickupLocation: leg.pickupLocation ?? (legType === "OUTBOUND" ? "28" : undefined),
          dropoffLocation: leg.dropoffLocation ?? (legType === "RETURN" ? "28" : undefined),
          scheduledDate: leg.scheduledAt,
          scheduledTime: leg.scheduledAt,
          estimatedDurationMinutes: leg.estimatedDurationMinutes,
          estimatedFinishDate: finish,
          estimatedFinishTime: finish
        };
      })
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
          legType: leg.legType,
          pickupLocation: leg.pickupLocation || undefined,
          dropoffLocation: leg.dropoffLocation || undefined,
          scheduledAt: combineScheduledAt(leg),
          estimatedDurationMinutes: leg.estimatedDurationMinutes,
          estimatedFinishAt: combineEstimatedFinishAt(leg)
          // Driver Income 不在这里手动填——Booking 建立之后由后端依 Driver Pool
          // 自动平分给每个 Leg（Mobile UAT Round 2）。
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

      <Form form={form} layout="vertical" initialValues={{ legs: defaultLegs() }} onValuesChange={handleValuesChange}>
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
              <div style={{ marginBottom: 8, fontWeight: 500 }}>
                行程 Leg（默认已建立去程/回程，几点载去、几点载回是核心业务资料，可以删除或再新增。
                司机收入会在建立后依 Driver Pool 自动平分，不需要在这里填）
              </div>
              {fields.map(({ key, name, ...rest }) => (
                <Card
                  key={key}
                  size="small"
                  style={{ marginBottom: 12 }}
                  title={
                    <Form.Item {...rest} name={[name, "legType"]} noStyle>
                      <Select style={{ width: 140 }} options={LEG_TYPE_OPTIONS} />
                    </Form.Item>
                  }
                  extra={<MinusCircleOutlined onClick={() => remove(name)} />}
                >
                  <Space direction="vertical" style={{ width: "100%" }} size={8}>
                    <Space wrap style={{ width: "100%" }}>
                      <Form.Item {...rest} name={[name, "pickupLocation"]} label="上车地点" style={{ marginBottom: 0 }}>
                        <Input placeholder="可留空" style={{ width: 200 }} />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, "dropoffLocation"]} label="下车地点" style={{ marginBottom: 0 }}>
                        <Input placeholder="可留空" style={{ width: 200 }} />
                      </Form.Item>
                    </Space>
                    <Space wrap style={{ width: "100%" }} align="start">
                      <Form.Item {...rest} name={[name, "scheduledDate"]} label="Pickup Date" style={{ marginBottom: 0 }}>
                        <DatePicker placeholder="选择日期" style={{ width: 160 }} />
                      </Form.Item>
                      <Form.Item {...rest} name={[name, "scheduledTime"]} label="Pickup Time" style={{ marginBottom: 0 }}>
                        <TimePicker format="HH:mm" placeholder="选择时间" style={{ width: 120 }} />
                      </Form.Item>
                      <Form.Item
                        {...rest}
                        name={[name, "timeNotConfirmed"]}
                        valuePropName="checked"
                        style={{ marginBottom: 0 }}
                      >
                        <Checkbox>时间未定</Checkbox>
                      </Form.Item>
                    </Space>
                    <Space wrap style={{ width: "100%" }} align="start">
                      <Form.Item
                        {...rest}
                        name={[name, "estimatedDurationMinutes"]}
                        label="Estimated Duration (分钟)"
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber placeholder="可留空" min={1} step={1} style={{ width: 160 }} />
                      </Form.Item>
                      <Form.Item
                        {...rest}
                        name={[name, "estimatedFinishDate"]}
                        label="Estimated Finish Date"
                        style={{ marginBottom: 0 }}
                      >
                        <DatePicker placeholder="自动算好，可手动改" style={{ width: 180 }} />
                      </Form.Item>
                      <Form.Item
                        {...rest}
                        name={[name, "estimatedFinishTime"]}
                        label="Estimated Finish Time"
                        style={{ marginBottom: 0 }}
                      >
                        <TimePicker format="HH:mm" placeholder="自动算好，可手动改" style={{ width: 120 }} />
                      </Form.Item>
                    </Space>
                  </Space>
                </Card>
              ))}
              <Button type="dashed" onClick={() => add({ legType: "ADDITIONAL" })} icon={<PlusOutlined />}>
                + 新增行程
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </ResponsiveModal>
  );
}
