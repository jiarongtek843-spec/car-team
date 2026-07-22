import { useEffect } from "react";
import { Alert, Button, Card, Form, Input, InputNumber, Select, Space, Switch, TimePicker, Typography, message } from "antd";
import dayjs from "dayjs";
import { useCompanySettingsQuery, useUpdateCompanySettingsMutation } from "./hooks";
import { usePermission } from "../auth/usePermission";
import { PERMISSIONS } from "../../common/permissions";
import type { UpdateCompanySettingsInput } from "./types";

interface FormValues {
  companyName: string;
  timezone: string;
  currency: string;
  defaultCommissionType: "PERCENTAGE" | "FIXED_AMOUNT";
  defaultCommissionValue: number;
  allowManualLegAllocation: boolean;
  requireDriverAccept: boolean;
  gpsUploadIntervalSeconds: number;
  connectionLostTimeoutSeconds: number;
  offlineTimeoutSeconds: number;
  defaultSettlementTime: dayjs.Dayjs;
  settlementTimezone: string;
  collectionVerificationRequired: boolean;
  maxUploadFileSizeMb: number;
}

export function CompanySettingsPage() {
  const [form] = Form.useForm<FormValues>();
  const { data: settings, isLoading } = useCompanySettingsQuery();
  const updateSettings = useUpdateCompanySettingsMutation();
  const canWrite = usePermission(PERMISSIONS.COMPANY_SETTINGS_WRITE);

  useEffect(() => {
    if (settings) {
      form.setFieldsValue({
        ...settings,
        defaultSettlementTime: dayjs(settings.defaultSettlementTime, "HH:mm")
      });
    }
  }, [settings, form]);

  async function handleSubmit() {
    const values = await form.validateFields();
    const input: UpdateCompanySettingsInput = {
      ...values,
      defaultSettlementTime: values.defaultSettlementTime.format("HH:mm")
    };
    await updateSettings.mutateAsync(input);
    message.success("Company Settings 已更新");
  }

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <Typography.Title level={4}>Company Settings</Typography.Title>

      {!canWrite && (
        <Alert
          type="info"
          showIcon
          message="只有 Owner 可以修改 Company Settings，你目前是唯读模式"
          style={{ marginBottom: 16 }}
        />
      )}

      <Form form={form} layout="vertical" disabled={!canWrite || isLoading}>
        <Card title="General" style={{ marginBottom: 16 }}>
          <Form.Item name="companyName" label="Company Name">
            <Input placeholder="例如：ABC Fleet Sdn Bhd" />
          </Form.Item>
          <Form.Item name="timezone" label="Timezone" rules={[{ required: true, message: "请输入 Timezone" }]}>
            <Input placeholder="例如：Asia/Kuala_Lumpur" />
          </Form.Item>
          <Form.Item name="currency" label="Currency" rules={[{ required: true, message: "请输入 Currency" }]}>
            <Input placeholder="例如：RM" style={{ width: 160 }} />
          </Form.Item>
        </Card>

        <Card title="Booking" style={{ marginBottom: 16 }}>
          <Form.Item
            name="defaultCommissionType"
            label="Default Commission Type"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { label: "Percentage", value: "PERCENTAGE" },
                { label: "Fixed Amount", value: "FIXED_AMOUNT" }
              ]}
              style={{ width: 200 }}
            />
          </Form.Item>
          <Form.Item
            name="defaultCommissionValue"
            label="Default Platform Commission"
            rules={[{ required: true, message: "请输入预设抽成" }]}
          >
            <InputNumber min={0} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item
            name="allowManualLegAllocation"
            label="Allow Manual Leg Allocation"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item name="requireDriverAccept" label="Require Driver Accept" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Card>

        <Card title="GPS" style={{ marginBottom: 16 }}>
          <Form.Item
            name="gpsUploadIntervalSeconds"
            label="GPS Upload Interval (秒)"
            rules={[{ required: true, message: "请输入上传间隔" }]}
          >
            <InputNumber min={1} max={300} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item
            name="connectionLostTimeoutSeconds"
            label="Connection Lost Timeout (秒)"
            rules={[{ required: true, message: "请输入 Connection Lost Timeout" }]}
          >
            <InputNumber min={1} max={3600} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item
            name="offlineTimeoutSeconds"
            label="Offline Timeout (秒)"
            rules={[{ required: true, message: "请输入 Offline Timeout" }]}
          >
            <InputNumber min={1} max={3600} style={{ width: 200 }} />
          </Form.Item>
        </Card>

        <Card title="Settlement" style={{ marginBottom: 16 }}>
          <Form.Item
            name="defaultSettlementTime"
            label="Default Settlement Time"
            rules={[{ required: true, message: "请选择时间" }]}
          >
            <TimePicker format="HH:mm" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item
            name="settlementTimezone"
            label="Settlement Timezone"
            rules={[{ required: true, message: "请输入 Settlement Timezone" }]}
          >
            <Input placeholder="例如：Asia/Kuala_Lumpur" />
          </Form.Item>
        </Card>

        <Card title="Collection" style={{ marginBottom: 16 }}>
          <Form.Item
            name="collectionVerificationRequired"
            label="Collection Verification Required"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="maxUploadFileSizeMb"
            label="Max Upload File Size (MB)"
            rules={[{ required: true, message: "请输入档案大小上限" }]}
          >
            <InputNumber min={1} max={20} style={{ width: 200 }} />
          </Form.Item>
        </Card>

        {canWrite && (
          <Space>
            <Button type="primary" onClick={handleSubmit} loading={updateSettings.isPending}>
              保存
            </Button>
          </Space>
        )}
      </Form>
    </div>
  );
}
