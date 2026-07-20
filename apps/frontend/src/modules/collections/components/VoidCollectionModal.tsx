import { Form, Input, message, Modal } from "antd";
import { useVoidCollectionMutation } from "../hooks";

interface FormValues {
  reason: string;
}

export function VoidCollectionModal({ collectionId, onClose }: { collectionId: number | null; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const voidCollection = useVoidCollectionMutation();
  const open = collectionId !== null;

  function handleClose() {
    form.resetFields();
    onClose();
  }

  async function handleSubmit() {
    if (!collectionId) return;
    const values = await form.validateFields();
    await voidCollection.mutateAsync({ id: collectionId, reason: values.reason });
    message.success("Collection 已作废");
    handleClose();
  }

  return (
    <Modal
      title="Void Collection"
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={voidCollection.isPending}
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
