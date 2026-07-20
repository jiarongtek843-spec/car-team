import { Form, Input, message, Modal } from "antd";
import { useCreateDriverMutation } from "../hooks";

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
    await createDriver.mutateAsync(values);
    message.success("Driver 建立成功");
    handleClose();
  }

  return (
    <Modal
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
    </Modal>
  );
}
