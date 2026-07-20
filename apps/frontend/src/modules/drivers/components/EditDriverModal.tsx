import { useEffect } from "react";
import { Form, Input, message, Modal } from "antd";
import { useUpdateDriverMutation } from "../hooks";
import type { Driver } from "../../../types/booking";

interface FormValues {
  name: string;
  phone?: string;
  vehiclePlateNumber?: string;
  remark?: string;
}

export function EditDriverModal({ driver, onClose }: { driver: Driver | null; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const updateDriver = useUpdateDriverMutation();
  const open = driver !== null;

  useEffect(() => {
    if (driver) {
      form.setFieldsValue({
        name: driver.name,
        phone: driver.phone ?? undefined,
        vehiclePlateNumber: driver.vehiclePlateNumber ?? undefined,
        remark: driver.remark ?? undefined
      });
    }
  }, [driver, form]);

  function handleClose() {
    form.resetFields();
    onClose();
  }

  async function handleSubmit() {
    if (!driver) return;
    const values = await form.validateFields();
    await updateDriver.mutateAsync({ id: driver.id, input: values });
    message.success("Driver 资料已更新");
    handleClose();
  }

  return (
    <Modal
      title={`编辑 Driver${driver ? ` #${driver.id}` : ""}`}
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={updateDriver.isPending}
      okText="储存"
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
      </Form>
    </Modal>
  );
}
