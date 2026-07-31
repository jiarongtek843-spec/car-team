import { Form, Input, message, Modal } from "antd";
import { useVoidSettlementMutation } from "../hooks";
import { ApiError } from "../../../api/http";

interface FormValues {
  reason: string;
}

export function VoidSettlementModal({ settlementId, onClose }: { settlementId: number | null; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const voidSettlement = useVoidSettlementMutation();
  const open = settlementId !== null;

  function handleClose() {
    form.resetFields();
    onClose();
  }

  async function handleSubmit() {
    if (!settlementId) return;
    const values = await form.validateFields();
    // Stabilization Bug Fix：mutateAsync 失败之前完全没有提示，Admin 会以为作废成功了。
    try {
      await voidSettlement.mutateAsync({ id: settlementId, reason: values.reason });
      message.success("Settlement 已作废");
      handleClose();
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : "作废失败，请重试");
    }
  }

  return (
    <Modal
      title="Void Settlement"
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={voidSettlement.isPending}
      okText="确定作废"
      cancelText="取消"
      okButtonProps={{ danger: true }}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="reason" label="Reason" rules={[{ required: true, message: "请填写作废原因" }]}>
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
