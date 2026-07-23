import { Form, Input, message } from "antd";
import { useCreateDriverMutation } from "../hooks";
import { ResponsiveModal } from "../../../common/ResponsiveModal";
import { ApiError } from "../../../api/http";

interface FormValues {
  name: string;
  phone?: string;
  vehiclePlateNumber?: string;
  remark?: string;
  username: string;
  password: string;
}

export function CreateDriverModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const createDriver = useCreateDriverMutation();

  function handleClose() {
    form.resetFields();
    onClose();
  }

  async function handleSubmit() {
    const values = await form.validateFields();
    try {
      await createDriver.mutateAsync(values);
      message.success("Driver 建立成功");
      handleClose();
    } catch (err) {
      // Mobile First UI Remediation：原本这里没有 catch，API 失败（例如 Username 重复）
      // 会变成一个使用者完全看不到的 unhandled rejection——Modal 停在原地、confirmLoading
      // 转圈结束，但没有任何讯息，使用者只会以为「没反应」。
      message.error(err instanceof ApiError ? err.message : "建立失败，请重试");
    }
  }

  return (
    <ResponsiveModal
      title="新增 Driver"
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={createDriver.isPending}
      okText="建立"
      cancelText="取消"
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="Full Name" rules={[{ required: true, message: "请输入姓名" }]}>
          <Input />
        </Form.Item>
        <Form.Item name="phone" label="Phone">
          <Input />
        </Form.Item>
        <Form.Item name="vehiclePlateNumber" label="Vehicle Plate Number">
          <Input />
        </Form.Item>
        <Form.Item name="remark" label="Remark">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item name="username" label="Username" rules={[{ required: true, min: 3, message: "至少 3 个字符" }]}>
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item name="password" label="Password" rules={[{ required: true, min: 6, message: "至少 6 个字符" }]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </ResponsiveModal>
  );
}
