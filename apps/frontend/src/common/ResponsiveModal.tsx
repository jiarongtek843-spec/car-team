import type { ReactNode } from "react";
import { Button, Drawer, Modal, Space } from "antd";
import { useIsMobile } from "./useIsMobile";

interface ResponsiveModalProps {
  title?: ReactNode;
  open: boolean;
  onCancel: () => void;
  onOk?: () => void;
  confirmLoading?: boolean;
  okText?: string;
  cancelText?: string;
  width?: number;
  children: ReactNode;
}

/**
 * Mobile Phase 1：桌面维持既有的 antd Modal（弹窗置中），手机改成从底部升起、
 * 占满全屏的 Drawer——单手操作时比置中的小弹窗更容易点到按钮，也符合
 * 「Modal 在手机全屏显示 / Drawer 代替弹窗」的要求。Props 刻意跟 antd Modal
 * 的常用子集（title/open/onCancel/onOk/confirmLoading/okText/cancelText）保持
 * 一致，方便既有的 Modal 呼叫端直接把标签换成 ResponsiveModal，不用重写逻辑。
 */
export function ResponsiveModal({ title, open, onCancel, onOk, confirmLoading, okText, cancelText, width, children }: ResponsiveModalProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer
        title={title}
        open={open}
        onClose={onCancel}
        placement="bottom"
        height="100%"
        styles={{ body: { paddingBottom: onOk ? 72 : undefined } }}
        footer={
          onOk ? (
            // safe-area-bottom：这个 footer 贴在全屏 Drawer 的最底部，iPhone 上正好
            // 是 Home Indicator 手势条的位置，不加这圈 padding 按钮会跟系统手势区重叠。
            <div className="safe-area-bottom">
              <Space style={{ width: "100%", justifyContent: "flex-end" }}>
                <Button onClick={onCancel}>{cancelText ?? "取消"}</Button>
                <Button type="primary" onClick={onOk} loading={confirmLoading}>
                  {okText ?? "确定"}
                </Button>
              </Space>
            </div>
          ) : undefined
        }
      >
        {children}
      </Drawer>
    );
  }

  return (
    <Modal title={title} open={open} onCancel={onCancel} onOk={onOk} confirmLoading={confirmLoading} okText={okText} cancelText={cancelText} width={width}>
      {children}
    </Modal>
  );
}
