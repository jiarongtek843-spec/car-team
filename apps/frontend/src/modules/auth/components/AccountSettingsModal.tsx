import { useState } from "react";
import { Form, Input, message } from "antd";
import { ResponsiveModal } from "../../../common/ResponsiveModal";
import { useAuth } from "../AuthContext";
import * as authApi from "../api";
import { ApiError } from "../../../api/http";

interface FormValues {
  currentPassword: string;
  newUsername?: string;
  newPassword?: string;
  confirmNewPassword?: string;
}

/**
 * 帐号自己改自己的用户名/密码——两个栏位都是选填，但至少要填一个（后端也会验证同一件
 * 事，这里先在前端挡一次，避免使用者送出空表单才发现被拒）。改用户名/密码前都要先输入
 * 目前密码，防止有人拿到还没登出的分页就直接改掉密码、把本人锁在外面。
 */
export function AccountSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const { setUser } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  function handleClose() {
    form.resetFields();
    onClose();
  }

  async function handleSubmit() {
    const values = await form.validateFields();
    if (!values.newUsername && !values.newPassword) {
      message.warning("请至少填写新用户名或新密码其中一项");
      return;
    }

    setSubmitting(true);
    try {
      const updated = await authApi.updateCredentials({
        currentPassword: values.currentPassword,
        newUsername: values.newUsername || undefined,
        newPassword: values.newPassword || undefined
      });
      setUser(updated);
      message.success("帐号资料已更新");
      handleClose();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "更新失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ResponsiveModal title="帐号设置" open={open} onCancel={handleClose} onOk={handleSubmit} confirmLoading={submitting} okText="保存">
      <Form form={form} layout="vertical">
        <Form.Item
          name="currentPassword"
          label="目前密码"
          rules={[{ required: true, message: "请输入目前密码" }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newUsername"
          label="新用户名（不改就留空）"
          rules={[{ min: 3, message: "用户名至少 3 个字符" }]}
        >
          <Input autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码（不改就留空）"
          rules={[{ min: 6, message: "密码至少 6 个字符" }]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmNewPassword"
          label="确认新密码"
          dependencies={["newPassword"]}
          rules={[
            {
              validator: (_, value) => {
                const newPassword = form.getFieldValue("newPassword");
                if (!newPassword && !value) return Promise.resolve();
                if (newPassword !== value) return Promise.reject(new Error("两次输入的新密码不一致"));
                return Promise.resolve();
              }
            }
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </ResponsiveModal>
  );
}
