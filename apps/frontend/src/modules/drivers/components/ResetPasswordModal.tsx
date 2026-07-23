import { Form, Input, message } from "antd";
import { useResetDriverPasswordMutation } from "../hooks";
import type { Driver } from "../../../types/booking";
import { ResponsiveModal } from "../../../common/ResponsiveModal";
import { ApiError } from "../../../api/http";

interface FormValues {
  password: string;
}

export function ResetPasswordModal({ driver, onClose }: { driver: Driver | null; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const resetPassword = useResetDriverPasswordMutation();
  const open = driver !== null;

  function handleClose() {
    form.resetFields();
    onClose();
  }

  async function handleSubmit() {
    if (!driver) return;
    const values = await form.validateFields();
    try {
      await resetPassword.mutateAsync({ id: driver.id, password: values.password });
      message.success("密码已重设");
      handleClose();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "重设失败，请重试");
    }
  }

  return (
    <ResponsiveModal
      title={`重设密码${driver ? ` — ${driver.name}` : ""}`}
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={resetPassword.isPending}
      okText="重设"
      cancelText="取消"
    >
      <Form form={form} layout="vertical">
        <Form.Item name="password" label="新密码" rules={[{ required: true, min: 6, message: "至少 6 个字符" }]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </ResponsiveModal>
  );
}
