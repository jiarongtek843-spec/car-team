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
  // 会跟它冲突的栏位）。Estimated Finish 也是同一套拆法，但只有 OUTBOUND（或
  // ADDITIONAL）才会显示这两个栏位——RETURN 不需要。
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
// 去程起点 / 回程终点默认都是公司基地「28」，符合实际业务流程——大多数行程都是从 28
// 出发、最后回到 28，中间才是客人真正的地址。
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
  // Estimated Finish Time 预设自动算（Pickup Time + Duration），但使用者直接编辑过某一个
  // Leg 的 Finish Time 之后，那笔就不该再被自动算的结果覆盖回去。
  const manualFinishLegIndexes = useRef<Set<number>>(new Set());
  // Mobile UAT Round 3：回程 Pickup Date/Time 预设 = 去程 Pickup + Duration 自动算好，
  // Admin 手动改过回程时间之后就不再被覆盖，除非去程时间/时长在那之前又变动。
  const manualReturnScheduleLegIndexes = useRef<Set<number>>(new Set());
  // 回程起点预设 = 去程终点，同样道理：手动改过就不再被自动同步覆盖。
  const manualReturnPickupLegIndexes = useRef<Set<number>>(new Set());

  function handleClose() {
    form.resetFields();
    setPasteText("");
    manualFinishLegIndexes.current.clear();
    manualReturnScheduleLegIndexes.current.clear();
    manualReturnPickupLegIndexes.current.clear();
    onClose();
  }

  function handleValuesChange(changedValues: Partial<FormValues>, allValues: FormValues) {
    const changedLegs = changedValues.legs;
    if (!changedLegs) return;

    changedLegs.forEach((changedLeg, index) => {
      if (!changedLeg) return;
      const legType = allValues.legs?.[index]?.legType;

      if ("estimatedFinishDate" in changedLeg || "estimatedFinishTime" in changedLeg) {
        manualFinishLegIndexes.current.add(index);
      } else {
        const touchesRelevantField =
          "scheduledDate" in changedLeg || "scheduledTime" in changedLeg || "estimatedDurationMinutes" in changedLeg;
        if (touchesRelevantField && !manualFinishLegIndexes.current.has(index)) {
          const leg = allValues.legs?.[index];
          if (leg) {
            const scheduledAt = combineDateTime(leg.scheduledDate, leg.scheduledTime);
            const finish = calculateEstimatedFinish(scheduledAt, leg.estimatedDurationMinutes);
            form.setFields([
              { name: ["legs", index, "estimatedFinishDate"], value: finish },
              { name: ["legs", index, "estimatedFinishTime"], value: finish }
            ]);
          }
        }
      }

      // 使用者直接改回程自己的 Pickup Date/Time -> 记成手动，之后去程再怎么变都不会覆盖它。
      if (legType === "RETURN" && ("scheduledDate" in changedLeg || "scheduledTime" in changedLeg)) {
        manualReturnScheduleLegIndexes.current.add(index);
      }
      // 使用者直接改回程自己的起点 -> 记成手动，不再跟去程终点同步。
      if (legType === "RETURN" && "pickupLocation" in changedLeg) {
        manualReturnPickupLegIndexes.current.add(index);
      }

      // 去程的 Pickup Date/Time/Duration 变了 -> 重新算出「该回去接的时间」，同步进所有
      // 还没被手动改过的回程 Leg。
      if (
        legType === "OUTBOUND" &&
        ("scheduledDate" in changedLeg || "scheduledTime" in changedLeg || "estimatedDurationMinutes" in changedLeg)
      ) {
        const outboundLeg = allValues.legs?.[index];
        if (outboundLeg) {
          const outboundScheduledAt = combineDateTime(outboundLeg.scheduledDate, outboundLeg.scheduledTime);
          const returnPickup = calculateEstimatedFinish(outboundScheduledAt, outboundLeg.estimatedDurationMinutes);
          allValues.legs?.forEach((otherLeg, otherIndex) => {
            if (otherLeg.legType === "RETURN" && !manualReturnScheduleLegIndexes.current.has(otherIndex)) {
              form.setFields([
                { name: ["legs", otherIndex, "scheduledDate"], value: returnPickup },
                { name: ["legs", otherIndex, "scheduledTime"], value: returnPickup }
              ]);
            }
          });
        }
      }

      // 去程终点变了 -> 同步进所有还没被手动改过的回程 Leg 的起点。
      if (legType === "OUTBOUND" && "dropoffLocation" in changedLeg) {
        const outboundLeg = allValues.legs?.[index];
        allValues.legs?.forEach((otherLeg, otherIndex) => {
          if (otherLeg.legType === "RETURN" && !manualReturnPickupLegIndexes.current.has(otherIndex)) {
            form.setFields([{ name: ["legs", otherIndex, "pickupLocation"], value: outboundLeg?.dropoffLocation }]);
          }
        });
      }
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
    manualReturnScheduleLegIndexes.current.clear();
    manualReturnPickupLegIndexes.current.clear();

    const parsedLegs = parsed.legs ?? [];
    const outboundParsed = parsedLegs[0];
    const outboundFinish = calculateEstimatedFinish(outboundParsed?.scheduledAt, outboundParsed?.estimatedDurationMinutes);

    form.setFieldsValue({
      girlName: parsed.girlName,
      totalAmount: parsed.totalAmountCents !== undefined ? parsed.totalAmountCents / 100 : undefined,
      notes: parsed.notes,
      legs: parsedLegs.map((leg, index) => {
        const legType: LegType = index === 0 ? "OUTBOUND" : index === 1 ? "RETURN" : "ADDITIONAL";

        if (legType === "RETURN") {
          return {
            legType,
            // 识别到地址就覆盖默认值；没识别到就用去程终点，去程也没有的话保留「28」。
            pickupLocation: leg.pickupLocation ?? outboundParsed?.dropoffLocation ?? "28",
            dropoffLocation: leg.dropoffLocation ?? "28",
            scheduledDate: outboundFinish,
            scheduledTime: outboundFinish
          };
        }

        const finish = calculateEstimatedFinish(leg.scheduledAt, leg.estimatedDurationMinutes);
        return {
          legType,
          pickupLocation: leg.pickupLocation ?? (legType === "OUTBOUND" ? "28" : undefined),
          dropoffLocation: leg.dropoffLocation,
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
          estimatedDurationMinutes: leg.legType === "RETURN" ? undefined : leg.estimatedDurationMinutes,
          estimatedFinishAt: leg.legType === "RETURN" ? undefined : combineEstimatedFinishAt(leg)
          // Driver Income 不在这里手动填——Booking 建立之后由后端依 Driver Pool
          // 自动平分给每个 Leg。
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
              label: "抽成设定",
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
              <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
                行程
              </Typography.Text>
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
                    {/* Mobile UAT Round 3：Estimated Duration/Finish 只有非回程的 Leg 才需要——
                        回程的接送时间是从去程算出来的，不需要自己的时长/结束时间。 */}
                    <Form.Item noStyle shouldUpdate={(prev, cur) => prev.legs?.[name]?.legType !== cur.legs?.[name]?.legType}>
                      {() =>
                        form.getFieldValue(["legs", name, "legType"]) === "RETURN" ? null : (
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
                        )
                      }
                    </Form.Item>
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
