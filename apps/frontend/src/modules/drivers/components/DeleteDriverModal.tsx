import { Alert, Form, Input, Typography, message } from "antd";
import { useDeleteDriverMutation } from "../hooks";
import type { Driver } from "../../../types/booking";
import { ResponsiveModal } from "../../../common/ResponsiveModal";
import { ApiError } from "../../../api/http";

interface FormValues {
  password: string;
}

/**
 * 真的从资料库删除这个 Driver（不是停用）——只有已停用的 Driver 才能删（Driver Management
 * 那边的「删除」连结本来就只在 status === INACTIVE 时才会显示，这里再确认一次是保险）。
 * 要求输入的是「操作者自己」（目前登入的这个 Admin/Manager 帐号）的密码，不是这个 Driver
 * 的密码——用来确认按下删除的真的是本人，不是有人拿着还没登出的分页手滑删错。
 */
export function DeleteDriverModal({ driver, onClose }: { driver: Driver | null; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const deleteDriver = useDeleteDriverMutation();
  const open = driver !== null;

  function handleClose() {
    form.resetFields();
    onClose();
  }

  async function handleSubmit() {
    if (!driver) return;
    const values = await form.validateFields();
    try {
      await deleteDriver.mutateAsync({ id: driver.id, password: values.password });
      message.success("Driver 已删除");
      handleClose();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "删除失败，请重试");
    }
  }

  return (
    <ResponsiveModal
      title={`删除 Driver${driver ? ` — ${driver.name}` : ""}`}
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={deleteDriver.isPending}
      okText="确定删除"
      cancelText="取消"
    >
      <Alert
        type="warning"
        showIcon
        message="删除后无法恢复"
        description="如果这位 Driver 已经有实际的工作/结算/GPS 纪录，系统会拒绝删除（保护财务资料完整），只能删除完全没有使用过的 Driver。"
        style={{ marginBottom: 16 }}
      />
      <Form form={form} layout="vertical">
        <Form.Item
          name="password"
          label={
            <span>
              请输入<Typography.Text strong>你自己</Typography.Text>目前登入的密码以确认
            </span>
          }
          rules={[{ required: true, message: "请输入密码" }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
      </Form>
    </ResponsiveModal>
  );
}
