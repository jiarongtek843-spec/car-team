import { Form, Input, message } from "antd";
import { useRejectLegMutation } from "../hooks";
import { ResponsiveModal } from "../../../common/ResponsiveModal";

interface FormValues {
  reason: string;
}

export function RejectLegModal({ legId, onClose }: { legId: number | null; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const rejectLeg = useRejectLegMutation();
  const open = legId !== null;

  function handleClose() {
    form.resetFields();
    onClose();
  }

  async function handleSubmit() {
    if (!legId) return;
    const values = await form.validateFields();
    await rejectLeg.mutateAsync({ legId, reason: values.reason });
    message.success("已拒绝该工作");
    handleClose();
  }

  return (
    <ResponsiveModal
      title="拒绝原因"
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={rejectLeg.isPending}
      okText="确定拒绝"
      cancelText="取消"
    >
      <Form form={form} layout="vertical">
        <Form.Item name="reason" label="原因" rules={[{ required: true, message: "请填写拒绝原因" }]}>
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </ResponsiveModal>
  );
}
