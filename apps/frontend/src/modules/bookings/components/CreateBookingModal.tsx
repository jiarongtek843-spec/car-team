import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Checkbox, DatePicker, Divider, Form, Input, InputNumber, message, Select, Space, TimePicker, Typography } from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { useCreateBookingMutation } from "../hooks";
import { parseBookingText } from "../parseBookingText";
import { ringgitToCents } from "../../../lib/money";
import { calculateEstimatedFinish } from "../../../lib/schedule";
import type { CreateBookingInput, LegType } from "../../../types/booking";
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
  // 会跟它冲突的栏位）。
  scheduledDate?: Dayjs;
  scheduledTime?: Dayjs;
  timeNotConfirmed?: boolean;
  // Mobile UAT Round 4：Duration 不再是使用者可编辑的栏位——只有 OCR 识别到才会有值，
  // 纯粹拿来内部计算回程接送时间，不渲染成表单栏位（也不给 Form.Item，直接存在这个
  // FormLeg 物件里，跟着 Form.List 一起走）。
  estimatedDurationMinutes?: number;
}

interface FormValues {
  girlName: string;
  totalAmount?: number;
  notes?: string;
  legs?: FormLeg[];
}

const LEG_TYPE_OPTIONS = (Object.keys(LEG_TYPE_LABEL) as LegType[]).map((value) => ({
  value,
  label: LEG_TYPE_LABEL[value]
}));

// 新建 Booking 预设直接给去程 + 回程两个 Leg——这是核心业务资料（几点载去、几点载回），
// 不该让使用者手动想到要自己加。之后仍然可以用「+ 新增行程」加第三个 ADDITIONAL Leg，
// 也可以把预设的两个都删掉（例如这张 Booking 目前还不知道任何行程细节）。
// 去程起点 / 回程终点默认都是公司基地——大多数行程都是从这里出发、最后回到这里，中间
// 才是客人真正的地址。用完整名称「28 BLVD」而不是单纯「28」，因为这段文字现在也会拿去
// 组 Waze / Google Maps 导航连结（LocationLink），只写「28」地图完全搜不到，「28 BLVD」
// 至少是个可以被搜到的地标名称。
const DEFAULT_BASE_LOCATION = "28 BLVD";

function defaultLegs(): FormLeg[] {
  return [
    { legType: "OUTBOUND", pickupLocation: DEFAULT_BASE_LOCATION },
    { legType: "RETURN", dropoffLocation: DEFAULT_BASE_LOCATION }
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

export function CreateBookingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const [pasteText, setPasteText] = useState("");
  const navigate = useNavigate();
  const createBooking = useCreateBookingMutation();
  // 回程 Pickup Date/Time 预设 = 去程 Pickup + Duration 自动算好，Admin 手动改过回程
  // 时间之后就不再被覆盖，除非去程时间在那之前又变动。
  const manualReturnScheduleLegIndexes = useRef<Set<number>>(new Set());
  // 回程起点预设 = 去程终点，同样道理：手动改过就不再被自动同步覆盖。
  const manualReturnPickupLegIndexes = useRef<Set<number>>(new Set());

  function handleClose() {
    form.resetFields();
    setPasteText("");
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

      // 使用者直接改回程自己的 Pickup Date/Time -> 记成手动，之后去程再怎么变都不会覆盖它。
      if (legType === "RETURN" && ("scheduledDate" in changedLeg || "scheduledTime" in changedLeg)) {
        manualReturnScheduleLegIndexes.current.add(index);
      }
      // 使用者直接改回程自己的起点 -> 记成手动，不再跟去程终点同步。
      if (legType === "RETURN" && "pickupLocation" in changedLeg) {
        manualReturnPickupLegIndexes.current.add(index);
      }

      // 去程的 Pickup Date/Time 变了 -> 用 Duration（通常来自 OCR）重新算出「该回去接的
      // 时间」，同步进所有还没被手动改过的回程 Leg。
      if (legType === "OUTBOUND" && ("scheduledDate" in changedLeg || "scheduledTime" in changedLeg)) {
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

    manualReturnScheduleLegIndexes.current.clear();
    manualReturnPickupLegIndexes.current.clear();

    const parsedLegs = parsed.legs ?? [];
    const outboundParsed = parsedLegs[0];
    // Duration 只在这里内部用一次，算出回程该几点接——不会渲染成表单栏位。
    const returnPickup = calculateEstimatedFinish(outboundParsed?.scheduledAt, outboundParsed?.estimatedDurationMinutes);

    form.setFieldsValue({
      girlName: parsed.girlName,
      totalAmount: parsed.totalAmountCents !== undefined ? parsed.totalAmountCents / 100 : undefined,
      notes: parsed.notes,
      legs: parsedLegs.map((leg, index) => {
        const legType: LegType = index === 0 ? "OUTBOUND" : index === 1 ? "RETURN" : "ADDITIONAL";

        if (legType === "RETURN") {
          return {
            legType,
            // 识别到地址就覆盖默认值；没识别到就用去程终点，去程也没有的话保留基地地址。
            pickupLocation: leg.pickupLocation ?? outboundParsed?.dropoffLocation ?? DEFAULT_BASE_LOCATION,
            dropoffLocation: leg.dropoffLocation ?? DEFAULT_BASE_LOCATION,
            scheduledDate: returnPickup,
            scheduledTime: returnPickup
          };
        }

        return {
          legType,
          pickupLocation: leg.pickupLocation ?? (legType === "OUTBOUND" ? DEFAULT_BASE_LOCATION : undefined),
          dropoffLocation: leg.dropoffLocation,
          scheduledDate: leg.scheduledAt,
          scheduledTime: leg.scheduledAt,
          estimatedDurationMinutes: leg.estimatedDurationMinutes
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
        // Commission 不在这里填——省略就是用 CompanySettings 的公司默认值（后端既有行为）。
        legs: values.legs?.map((leg) => ({
          legType: leg.legType,
          pickupLocation: leg.pickupLocation || undefined,
          dropoffLocation: leg.dropoffLocation || undefined,
          scheduledAt: combineScheduledAt(leg),
          // Duration 只有去程/额外行程才有意义（回程的时间已经是算好的结果），当成
          // Booking metadata 存起来，不影响 Driver Income（照样自动依 Driver Pool 平分）。
          estimatedDurationMinutes: leg.legType === "RETURN" ? undefined : leg.estimatedDurationMinutes
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
                    {/* Duration 不渲染成可见栏位（Mobile UAT Round 4）——但仍要注册在 Form
                        里，OCR 识别到的值才能跟着这个 Leg 一起走、留着给回程时间计算用。 */}
                    <Form.Item {...rest} name={[name, "estimatedDurationMinutes"]} hidden>
                      <InputNumber />
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
